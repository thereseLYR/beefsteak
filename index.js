import express, { json, request } from 'express';
import pg from 'pg';
import methodOverride from 'method-override';
import jsSHA from 'jssha';
import cookieParser from 'cookie-parser';

const app = express()
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));
app.use(methodOverride('_method')); // Override POST requests with query param ?_method=PUT to be PUT requests
app.use(express.static('public'));
app.use(cookieParser());

const { Pool } = pg;
const pgConnectionConfigs = {
	user: 'postgres',
	host: 'localhost',
	database: 'beefsteak',
	port: 5432, // Postgres server always runs on this port by default
};
const pool = new Pool(pgConnectionConfigs);

app.get('/', (req, res) => {
  res.render('index')
  })

app.post('/tasklist/list', async (req, res) => { // async gives access to await - wait for function to complete before it continues
  try {
    console.log('tasklist submisison request came in');

    const inputs = req.body;
    console.log('inputs:', inputs)

    // cookies here maybe

    const listQueryString = `INSERT INTO task_lists (list_name, list_description) VALUES ($1, $2) RETURNING id`;
    const listQueryValues = [ inputs['list-name'], inputs['list-description'] ]
    
    const taskQueryArr = [inputs['task-1'], inputs['task-2'], inputs['task-3']]

    pool
      .query(listQueryString, listQueryValues)
      .then ((result) => {
        // console.log(result)
        const latestTasklistID = result['rows'][0]['id'];
        console.log("latestTasklistID is:", latestTasklistID);
        taskQueryArr.forEach((element) => {
          const taskQueryString = `INSERT INTO tasks (list_id, task_name) VALUES ($1, $2)`;
          console.log("inserting tasks under listID:", latestTasklistID);
          const taskQueryValues = [ latestTasklistID, element ];
          pool.query(taskQueryString, taskQueryValues);
        })
      })
    res.redirect('/');
  } catch (err) {
    console.error(err.message)
  }
  
})

app.get('/register', (req, res) => {
  res.render('signup')
})

app.post('/register', (req, res) => {
  console.log('attempting POST')

  // i could probably make the hashing stuff into a separate function
  // initialise the SHA object
  const shaObj = new jsSHA('SHA-512', 'TEXT', { encoding: 'UTF8' });
  console.log('SHA objecct created\n')
  console.log('req.body:',req.body)
  // input the password from the request to the SHA object
  shaObj.update(req.body.password);
  // get the hashed password as output from the SHA object
  const hashedPassword = shaObj.getHash('HEX');
  
  // store the hashed password in our DB
  const queryString = 'INSERT INTO users (user_name, first_name, last_name, email, password) VALUES ($1, $2, $3, $4, $5)' // to show ourselves what data was sent
  const values = [ req.body.user_name, req.body.first_name, req.body.last_name, req.body.email, hashedPassword ];

  pool
    .query(queryString, values)
    .then ((result) => {
      // console.log('User insert query done. result:', result);
      // console.log('hashing OK. redirecting...')
      res.redirect('/login')
    })
    .catch ((error) => {
    console.log(error);
  });
  // use app.locals to define your own 'global variables' in EJS files. useful for things like navbears where you want to have dynamic content like updating a welcome message with the user's name.
})

app.get('/login', (req, res) => {
  res.render('login')
})

app.post('/login', (req, res) => {
  // retrieve the user entry using their email
  const usernameQueryvalues = [req.body.user_name];
  pool.query('SELECT * from users WHERE user_name=$1', usernameQueryvalues, (error, result) => {
    // console.log(result.rows);
    if (error) {
      console.log('Error executing query', error.stack);
      res.status(503).send(result.rows);
      return;
    }
    if (result.rows.length === 0) { // not a valid username
      res.status(403).send('login failed!');
      return;
    }

  const retrievedUserInfo = result.rows[0];

  const shaObj = new jsSHA('SHA-512', 'TEXT', { encoding: 'UTF8' });
  // input the password from the request to the SHA object
  shaObj.update(req.body.password);
  // get the hashed password as output from the SHA object
  const hashedPassword = shaObj.getHash('HEX');

  if(retrievedUserInfo.password !== hashedPassword){
     res.status(403).send('Invalid Username or Password.');
      return;
  }
  res.cookie('userID', retrievedUserInfo.id)
  // redirect on login success
  res.redirect('/');
  });
});

app.get('/profile', (req, res) => {
  res.render('profile')
})

app.listen(3000, () => console.log('Server Started'))