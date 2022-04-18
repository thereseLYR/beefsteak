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

// Auth stuff

const SALT = ''

/**
 * hashes an input string according to the salt variable
 * @param {string} input
 * @return {string} - hashed string result after hashing and salting
 */
const getHash = (input) => {
  // create new SHA object
  const shaObj = new jsSHA('SHA-512', 'TEXT', { encoding: 'UTF8' });
  // create an unhashed cookie string based on user ID and salt
  const unhashedString = `${input}-${SALT}`;
  // generate a hashed cookie string using SHA object
  shaObj.update(unhashedString);
  return shaObj.getHash('HEX');
};

const loginCheck = (req, res, next) => {
  if (!req.cookies.userIdHash) {
    res.render('error', { message: 'Please log in to continue.' });
  }
  req.isUserLoggedIn = false; // default value
  const idHash = getHash(req.cookies.userId);
  if(req.cookies.userIdHash === idHash){
    req.isUserLoggedIn = true;
    res.locals.userId = req.cookies.userIdHash; // pass userId of the user into middleware (as hashed).
    // use app.locals to define your own 'global variables' in EJS files. useful for things like navbears where you want to have dynamic content like updating a welcome message with the user's name.
  }
  next();
};

const renderCompletedTasklist = function(listID){}

app.get('/', (req, res) => {
  if(req.cookies.sessionTasks){
    res.redirect('/inprogress')
  }
  res.render('index')
  })

app.post('/tasklist/list', async (req, res) => { // async gives access to await - wait for function to complete before it continues
    const inputs = req.body;
    // let taskCookieObj = { task_list_id: 0, task_ids_array: []};
    const taskCookieObj = { task_names_array: [] };

    let listQueryString = `INSERT INTO task_lists (list_name, list_description) VALUES ($1, $2) RETURNING id`;
    const listQueryValues = [ inputs['list-name'], inputs['list-description'] ]
    const taskQueryArr = [inputs['task-1'], inputs['task-2'], inputs['task-3']]

    // edit query to include userID if user is logged in
    console.log('req.cookies', req.cookies)
    if(req.cookies.userID){
      listQueryValues.push(req.cookies.userID)
      listQueryString = `INSERT INTO task_lists (list_name, list_description, assigned_user) VALUES ($1, $2, $3) RETURNING id`
    }

    pool
      .query(listQueryString, listQueryValues)
      .then ((result) => {
        const latestTasklistID = result['rows'][0]['id'];
        taskCookieObj['task_list_id'] = latestTasklistID
        taskQueryArr.forEach((taskElement) => {
          const taskQueryString = `INSERT INTO tasks (list_id, task_name) VALUES ($1, $2)`;
          const taskQueryValues = [ latestTasklistID, taskElement ];
          taskCookieObj['task_names_array'].push(taskElement)
          pool.query(taskQueryString, taskQueryValues);
        })
      })
      .then( () => {
        // console.log('taskCookieObj:', taskCookieObj)
        // cookie will be used to generate list for users to strike off their tasks
        res.cookie('sessionTasks', taskCookieObj)
        // change redirect to another page later
        res.redirect('/inprogress');
      })
      .catch((error) => {
        console.log('ERROR CAUGHT')
        console.error(error.message)
      })
  
})

app.get('/register', (req, res) => {
  res.render('signup')
})

app.post('/register', (req, res) => {
  console.log('attempting POST')
  const hashedPassword = getHash(req.body.password)
  
  // store the hashed password in our DB
  const queryString = 'INSERT INTO users (user_name, first_name, last_name, email, password) VALUES ($1, $2, $3, $4, $5)'
  const values = [ req.body.user_name, req.body.first_name, req.body.last_name, req.body.email, hashedPassword ];

  pool
    .query(queryString, values)
    .then ((result) => {
      res.redirect('/login')
    })
    .catch ((error) => {
    console.log('ERROR CAUGHT')
    console.log(error.message);
  });
})

app.get('/login', (req, res) => {
  res.render('login')
})

app.post('/login', (req, res) => {
  // retrieve the user entry using their email
  const usernameQueryvalues = [req.body.user_name];
  pool
  .query('SELECT * from users WHERE user_name=$1', usernameQueryvalues)
  .then((result) => {

    if (result.rows.length === 0) { // not a valid username
      res.status(403).send('login failed!');
      return;
    }

    const retrievedUserInfo = result.rows[0];
    const hashedPassword = getHash(req.body.password)

    if(retrievedUserInfo.password !== hashedPassword){
      res.status(403).send('Invalid Username or Password.');
        return;
    }
    res.cookie('userID', retrievedUserInfo.id)
    res.cookie('userIdHash', getHash(retrievedUserInfo.id))
    // redirect on login success
    res.redirect('/');
  })
  .catch ((error) => {
    console.log('Error executing query', error.stack);
    res.status(503).send(result.rows);
    return;
  });
  });

app.get('/new', (req, res) => {
  res.clearCookie('sessionTasks')
  res.redirect('/')
  })

app.get('/inprogress', (req, res) => {
  if(!req.cookies.sessionTasks){
    res.redirect('/')
  }

  const cookieTasksObj = req.cookies.sessionTasks
  const DBTasksObj = {}
  // use cookieTaskObj to query a DBTasksObj, which pulls more detailed information like tasklist name, description, and task names.
  const selectListQueryStr = `SELECT * FROM task_lists WHERE id = ${cookieTasksObj.task_list_id}`
  const selectTasksQueryStr = `SELECT * FROM tasks WHERE list_id = ${cookieTasksObj.task_list_id}`
  // pass DBtasksObj to EJS, which generates rows to mark completion with POST requests
  pool
    .query(selectListQueryStr)
    .then((result) => {
      DBTasksObj['list_info'] = result['rows']
    })
    .then(() => {
      pool
        .query(selectTasksQueryStr)
        .then((result) => {
          // to remove elements of task_info if task name is empty
        DBTasksObj['task_info'] = result['rows']
      })
        .then(() => {
          // console.log(DBTasksObj['task_info'][0])
        res.render('tasks-inprogress', DBTasksObj) 
        })  
    })
})

app.put("/inprogress/task/:taskID/edit", (req, res) => {
  const taskID = req.params.taskID
  const taskCompletionQueryStr = `UPDATE tasks SET completion_datetime = now(), completion_status = TRUE WHERE id = ${taskID}`
  pool
    .query(taskCompletionQueryStr)
    .then((result) =>{
      // console.log(result)
      res.redirect('/inprogress')
    })
    .catch((error) => {
      console.log('ERROR CAUGHT')
      console.log(error.message);
    })
    
})

app.post("/complete/list/:listID", (req, res) => {
  // query to update tasklist completion status and datetime based on cookie information
  const listID = req.params.listID
  const listCompletionQueryStr = `UPDATE task_lists SET completion_datetime = now(), completion_status = TRUE WHERE id = ${listID}`
  pool
    .query(listCompletionQueryStr)
    .then((result) => {
      console.log(result)
      res.clearCookie('sessionTasks') // delete tasks cookie
      res.cookie('lastSession', listID) // create new cookie for prev session
      // to add report for last session in EJS
      res.render('tasks-complete')
    })
    .catch((error) => {
    console.log('ERROR CAUGHT')
    console.log(error.message);
    })
})

app.get('/complete/list/:listID', (req, res) => {
  const requestedListID = req.params.listID
  const listQueryStr = `SELECT * FROM task_lists WHERE id = ${requestedListID}`
  const taskQueryStr = `SELECT id, task_name, completion_status, completion_datetime - created_at AS duration FROM tasks where list_id = ${requestedListID} ORDER BY id ASC`

  const results = Promise.all([
    pool.query(listQueryStr),
    pool.query(taskQueryStr)
  ])

  results.then((combinedResults) => {
    const [ listQueryResults, taskQueryResults ] = combinedResults;
    const listData = listQueryResults.rows
    const taskData = taskQueryResults.rows
    // taskdata contains a PostgresInterval object that has the properties of minutes, seconds, and milliseconds
    // we will only use minutes and seconds for our purpouses
    // this can be accessed from listSummaryObj['taskData'][i]['duration']['minutes']
    const listSummaryObj = {listData, taskData}
    // taskdata is an array of 3 objects
    res.render('tasks-complete', listSummaryObj);
  })
})

app.get("/complete/last", (req, res) => {
  const latestTasklistID = req.cookies.lastSession
  const listQueryStr = `SELECT * FROM task_lists WHERE id = ${latestTasklistID}`
  const taskQueryStr = `SELECT id, task_name, completion_status, completion_datetime - created_at AS duration FROM tasks where list_id = ${latestTasklistID} ORDER BY id ASC`

  const results = Promise.all([
    pool.query(listQueryStr),
    pool.query(taskQueryStr)
  ])

  results.then((combinedResults) => {
    const [ listQueryResults, taskQueryResults ] = combinedResults;
    const listData = listQueryResults.rows
    const taskData = taskQueryResults.rows
    // taskdata contains a PostgresInterval object that has the properties of minutes, seconds, and milliseconds
    // we will only use minutes and seconds for our purpouses
    // this can be accessed from listSummaryObj['taskData'][i]['duration']['minutes']
    const listSummaryObj = {listData, taskData}
    // taskdata is an array of 3 objects
    res.render('tasks-complete', listSummaryObj);
  })

})

app.get('/profile', loginCheck, (req, res) => {
  if (req.isUserLoggedIn === false) { // test from loginCheck middleware
    res.status(403).send('please log in.');
  } 
  // to add all tasklists owned by the user
  // more queries
  // to add graph showing most recent performance
  res.render('profile')
})

app.listen(3000, () => console.log('Server Started'))