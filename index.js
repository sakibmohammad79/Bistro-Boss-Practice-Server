const express = require("express");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
var jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KAY)
const port = process.env.PORT || 5000;

//middleware
app.use(cors());
app.use(express.json());

const verifyJwt = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }
  //bearer token
  const token = authorization.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.5a8lj4m.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const usersCollection = client.db("bistroBossDb").collection("users");
    const menuCollection = client.db("bistroBossDb").collection("menu");
    const reviewCollection = client.db("bistroBossDb").collection("reviews");
    const cartCollection = client.db("bistroBossDb").collection("carts");
    const paymentCollection = client.db("bistroBossDb").collection("payments");

    //jwt
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    //verify admin,  Warning use verifyJwt before using verifyAdmin
    const verifyAdmin = async(req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if(user?.role !== "admin"){
        return res
        .status(403)
        .send({ error: true, message: "unauthorized access" });
      }
      next();
    }

    //user related api
    app.post("/users", async (req, res) => {
      const users = req.body;
      const query = { email: users.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists" });
      }
      const result = await usersCollection.insertOne(users);
      res.send(result);
    });


    /* secure layer: 
     * Do not show navbar link
     * Use jwt token
     * use verify Admin
     * 
    */

    //user get
    app.get("/users", verifyJwt, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    //check admin
    app.get("/users/admin/:email", verifyJwt, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        res.send({ admin: false });
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = { admin: user?.role === "admin" };
      res.send(result);
    });

    //make admin
    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    //users delete
    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });

    //menu
    app.get("/menu", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });

    //add menu item
    app.post('/menu', verifyJwt, verifyAdmin, async (req, res) => {
      const newItem = req.body;
      const result = await menuCollection.insertOne(newItem);
      res.send(result);
    })
    //menu.deleted
    app.delete('/menu/:id', verifyJwt, verifyAdmin, async(req,res) => {
      const id = req.params.id;
      const query = { _id : new ObjectId(id) };
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    })

    //review
    app.get("/reviews", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    //add to cart
    app.post("/carts", async (req, res) => {
      const item = req.body;
      const result = await cartCollection.insertOne(item);
      res.send(result);
    });

    //cart data get
    app.get("/carts", verifyJwt, async (req, res) => {
      const email = req.query.email;
      if (!email) {
        res.send([]);
      }

      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res
          .status(403)
          .send({ error: true, message: "forbidden access" });
      }

      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    //cart delete
    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    //PAYMENT GATEWAY
    app.post('/create-payment-intent', verifyJwt, async (req, res) => {
      const {price} = req.body;
      const amount = parseInt(price*100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    })

    //payment related api
    app.post('/payments', verifyJwt, async (req, res) => {
      const payment = req.body;
      const insertedResult = await paymentCollection.insertOne(payment);
      
      const query = {_id: { $in: payment.cartItems.map(id => new ObjectId(id))}}
      const deletedResult = await cartCollection.deleteMany(query);
      
      res.send({insertedResult, deletedResult});
      
    })

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("bistro boss are running");
});

app.listen(port, () => {
  console.log(`bistro boss sitting on ${port}`);
});
