const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


const app  = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qtxkd.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyjwt(req, res, next){
    const authHeader = req.headers.authorization;
    if(!authHeader){
        return res.status(401).send({message: 'UnAuthorizid access'});
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function(err, decoded){
        if(err){
            return res.status(403).send({message: 'Forbidden Access'})
        }
        req.decoded = decoded;
        next();
    })
    
}

async function run(){ 
    try{
        await client.connect();
        const servicesCollection = client.db('doctorsPortal').collection('services');
        const bookingCollection = client.db('doctorsPortal').collection('bookings');
        const userCollection = client.db('doctorsPortal').collection('users');
        const doctorCollection = client.db('doctorsPortal').collection('doctors');
        const paymentCollection = client.db('doctorsPortal').collection('payments');

        const verifyAdmin = async(req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({email: requester});
            if(requesterAccount.role === 'admin'){
                next();
            }
            else{
                res.status(403).send({message: 'forbidden'})
            }
        }
        
        app.post('/create-payment-intent', verifyjwt, async(req, res) => {
            const service = req.body;
            const price = service.price;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
            res.send({clientSecret: paymentIntent.client_secret})
        });

        app.get('/service', async(req, res) => {
            const query = {};
            const cursor = servicesCollection.find(query).project({name: 1});
            const services = await cursor.toArray();
            res.send(services)
        });

        app.get('/user', verifyjwt, async(req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users)
        });
        
        app.get('/admin/:email', async(req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({email: email});
            const isAdmin = user.role === 'admin';
            res.send({admin: isAdmin});
        })

        app.put('/user/admin/:email',verifyjwt, verifyAdmin, async(req, res) => {
            const email = req.params.email;
                const filter = {email: email};
                const updateDoc = {
                $set: {role: 'admin'},
                };
                const result = await userCollection.updateOne(filter, updateDoc);
                res.send(result);
        })

        app.put('/user/:email', async(req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = {email: email};
            const options = {upsert: true};
            const updateDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({email: email}, process.env.ACCESS_TOKEN_SECRET, {expiresIn: '1h'})
            res.send({result, token});
        });

        app.get('/available', async(req, res) => {
            const date = req.query.date || 'May 11, 2022';

            const services = await servicesCollection.find().toArray();
            const query = {date: date};
            const bookings = await bookingCollection.find(query).toArray();
            services.forEach(service => {
                const serviceBookings = bookings.filter(b => b.treatment === service.name);

                const booked = serviceBookings.map(s => s.slot);

                const available = service.slots.filter(slot => !booked.includes(slot));
                 
                service.slots = available
            });

            res.send(services)
        });

        app.get('/booking',verifyjwt, async(req, res) => {
            const patient = req.query.patient;
            const decodedEmail = req.decoded.email;
            if(patient === decodedEmail){
                const query = {patient: patient};
                const bookings = await bookingCollection.find(query).toArray(); 
                res.send(bookings);
            }
            else{
                return res.status(403).send({message: 'forbidden access'})
            }
        });

        app.get('/booking/:id', verifyjwt, async(req, res)=> {
            const id = req.params.id;
            const query = {_id: ObjectId(id)};
            const booking = await bookingCollection.findOne(query);
            res.send(booking);
        })

        app.post('/booking', async(req, res) => {
            const booking = req.body;
            const query = {treatment: booking.treatment, date: booking.date, patient: booking.patient};
            const exist = await bookingCollection.findOne(query);
            if(exist){
                return res.send({success: false, booking: exist})
            }
            const result = await bookingCollection.insertOne(booking);
            return res.send({success: true, result});
        });


        app.patch('/booking/:id', verifyjwt, async(req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = {_id: ObjectId(id)};
            const updateDoc = {
                $set: {
                    paid: true,
                    transectionId: payment.transectionId
                }
            }
            const result = await paymentCollection.insertOne(payment);
            const updatedBooking = await bookingCollection.updateOne(filter, updateDoc);
            res.send(updateDoc);
        })

        app.get('/doctor', verifyjwt, verifyAdmin, async(req, res) =>{
            const doctors = await doctorCollection.find().toArray();
            res.send(doctors);
        })

        app.post('/doctor', verifyjwt, verifyAdmin, async(req, res) => {
            const doctor = req.body;
            const result = await doctorCollection.insertOne(doctor);
            res.send(result);
        });

        app.delete('/doctor/:email', verifyjwt, verifyAdmin, async(req, res) => {
            const email = req.params.email;
            const filter = {email: email};
            const result = await doctorCollection.deleteOne(filter);
            res.send(result);
        })
    }
    finally{

    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('hello world')
});

app.listen(port, () => {
    console.log(`example app listenting on port ${port}`)
})