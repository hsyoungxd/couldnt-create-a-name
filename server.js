const express = require("express");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const session = require("express-session");
var methodOverride = require('method-override');
const {MongoClient, ObjectId} = require("mongodb");
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({extended: false}));
app.use(methodOverride('_method'))
app.use(session({
    secret: "secret",
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: false, 
        maxAge: 30 * 24 * 60 * 60 * 1000
    }
}));

// app.use((req, res, next) => {
//     console.log(`Request Method: ${req.method}`); // Should show PUT if override works
//     next();
// });

app.set("view engine", "ejs");

const PORT = 4000;
let db;

async function connect(){
    try{
        const connection = await MongoClient.connect(process.env.DB_LINK);
        db = connection.db();
    }catch(error){
        throw error;
    }
}
connect();

let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});


app.get('/register', (req, res)=>{
    res.render("registerpage", {messages: [], name: '', email: ''});
});

app.get('/login', (req, res)=>{
    res.render("loginpage", {messages: [], email: ''});
});

app.get('/home', async (req, res)=>{
    if(!req.session.user){
        res.redirect('/login');
    }else{
        try{
            const quote = await (await fetch("https://animechan.xyz/api/random")).json();
            const exchange = await (await fetch("https://api.exchangerate-api.com/v4/latest/USD")).json();
            const cryptoData = await (await fetch("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=30&interval=daily")).json();
            res.render('homepage', {quote: quote, exchangeData: exchange, cryptoData: cryptoData});
        }catch(error){
            res.status(500).send(error.toString());
        }
    }
});

app.get('/portfolios', async (req, res)=>{
    try{
        if(!req.session.user){
            res.redirect('/login');
        }else{
            let portfolios = await db.collection("portfolio").find().toArray();
            if(req.session.user.permissions != 'user'){
                res.render("portfoliopage", {portfolios: portfolios, admin: true});
            }else{
                res.render("portfoliopage", {portfolios: portfolios, admin: false});
            }
        }
    }catch(error){
        res.status(500).send(error.toString());
    }
});

app.get('/portfolios/:id', async (req,res)=>{
    try{
        if(!req.session.user){
            res.redirect('/login');
        }else{
            let id = req.params.id;
            let portfolio = await db.collection("portfolio").findOne({_id: new ObjectId(id)});
            if(!portfolio){
                res.status(404).send("Portfolio not found");
            }else{
                if(req.session.user.permissions != 'user'){
                    res.render("singleportfoliopage", {portfolio: portfolio, admin: true});
                }else{
                    res.render("singleportfoliopage", {portfolio: portfolio, admin: false});
                }
            }
        }   
    }catch(error){
        res.status(500).send(error.toString());
    }
});


app.post('/register', async (req, res)=>{
    let {name, email, password, cpassword} = req.body;
    let messages = [];
    
    if(!name || !email || !password || !cpassword){
        messages.push({message: "Please fill all fields"});
    }
    if(password != cpassword){
        messages.push({message: "Passwords do not match"});
    }
    if(password.length < 4){
        messages.push({message: "Password has less than 4 characters"});
    }
    if(messages.length != 0){
        res.render("registerpage", {messages, name, email});
    }else{
        let hashedpass = await bcrypt.hash(password, 10);
        try{
            let checkemail = await db.collection("users").findOne({"email": email});
            if(checkemail){
                messages.push({message: "Email is already in use"});
                res.render("registerpage", {messages, name, email: ''});
            }else{
                await db.collection("users").insertOne({"name": name, "email": email, "password": hashedpass, "permissions": "user"});
                messages.push({message: "Successfully registered"});
                let info = await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: email,
                    subject: "Registration",
                    text: "You have successfully registered."
                });
                console.log("Message sent: " + info.messageId);
                res.render("registerpage",{messages, name: '', email: ''});
            }
        }catch(error){
            res.status(500).send(error);
        }
    }
});

app.post('/login', async (req, res)=>{
    let {email, password} = req.body;
    let messages = [];
    if(!email || !password){
        messages.push({message: "Please fill all fields"});
    }
    try{
        let checkemail = await db.collection("users").findOne({"email": email});
        if(checkemail){
            const isMatch = await bcrypt.compare(password, checkemail.password);
            if(isMatch){
                req.session.user = checkemail;
                res.redirect("/home");
            }else{
                messages.push({message: "Wrong password"});
                res.render("loginpage", {messages, email});
            }
        }else{
            messages.push({message: "Such email is not registered"});
            res.render("loginpage", {messages, email});
        }
    }catch(error){
        res.status(500).send(error);
    }
});

app.post('/logout', async (req, res)=>{
    try{
        req.session.destroy();
        res.redirect('/login');
    }catch(error){
        res.status(500).send(error);
    }
});

app.post('/portfolios', async (req, res)=>{
    let {image1, image2, image3, name_en, name_ru, desc_en, desc_ru} = req.body;
    try{
        const portfolio = {image1, image2, image3, name_en, name_ru, desc_en, desc_ru, timestamp: new Date()};
        await db.collection("portfolio").insertOne(portfolio);
        res.redirect('/portfolios')
        // res.status(200).send(portfolio);
    }catch(error){
        res.status(500).send(error);
    }
});

app.put('/portfolios/:id', async (req, res)=>{
    let {image1, image2, image3, name_en, name_ru, desc_en, desc_ru} = req.body;
    try{
        const id = req.params.id;
        const portfolio = {image1, image2, image3, name_en, name_ru, desc_en, desc_ru, timestamp: new Date()};
        const result = await db.collection("portfolio").updateOne({_id: new ObjectId(id)}, {$set: portfolio});
        if(result.modifiedCount === 0){
            res.status(500).send("Portfolio not found");
        }else{
            res.redirect('/portfolios');
        }
    }catch(error){
        res.status(500).send(error);
    }
});

app.delete('/portfolios/:id', async (req, res)=>{
    try{
        const id = req.params.id;
        const result = await db.collection("portfolio").deleteOne({_id: new ObjectId(id)});
        if(result.deletedCount === 0){
            res.status(500).send("Portfolio not found");
        }else{
            res.redirect('/portfolios');
        }
    }catch(error){
        res.status(500).send(error);
    }
});



app.listen(PORT, ()=>{
    console.log("Server runs at port " + PORT);
});