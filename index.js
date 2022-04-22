import express, { json, raw, request } from 'express';
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
  const idHash = getHash(req.cookies.userID);
  if(req.cookies.userIdHash === idHash){
    req.isUserLoggedIn = true;
    res.locals.userId = req.cookies.userIdHash; // pass userId of the user into middleware (as hashed).
    // use app.locals to define your own 'global variables' in EJS files. useful for things like navbears where you want to have dynamic content like updating a welcome message with the user's name.
  }
  next();
};

const getChartDataArr = function(statsArr, key){
  let newCountArr = [];
  statsArr.forEach((taskObject) => {
    newCountArr.push(taskObject[key])
  })
  return newCountArr
}

app.get('/', (req, res) => {
  if(req.cookies.sessionTasks){
    res.redirect('/inprogress')
  }
  res.render('index')
  })

app.post('/tasklist/list', (req, res) => {
    const inputs = req.body;
    // let taskCookieObj = { task_list_id: 0, task_ids_array: []};
    const taskCookieObj = { task_names_array: [] };

    let listQueryString = `INSERT INTO task_lists (list_name, list_description) VALUES ($1, $2) RETURNING id`;
    const listQueryValues = [ inputs['list-name'], inputs['list-description'] ]
    const taskQueryArr = [inputs['task-1'], inputs['task-2'], inputs['task-3']]

    // edit query to include userID if user is logged in
    // console.log('req.cookies', req.cookies)
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
        console.log('ERROR CAUGHT');
        console.error(error.message);
      })
  
})

app.get('/register', (req, res) => {
  res.render('signup')
})

app.post('/register', (req, res) => {
  // console.log('attempting POST')
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

app.get('/groups', loginCheck, (req, res) => {
  // check if user is currently in a group
  // if yes, redirect to group-specific page with task history and stats
  // if no, render page to prompt user to join a group or create a new group
  if (req.isUserLoggedIn === false) { // test from loginCheck middleware
    res.status(403).send('please log in.');
  } else {
    const userGroupQueryStr = `SELECT groupid FROM users WHERE id = ${req.cookies.userID}`
    pool
      .query(userGroupQueryStr)
      .then((result) => {
        // console.log(result)
        const userGroupId = result['rows'][0]['groupid']
        if(userGroupId == null){
          res.redirect('/groups/join');
        } else {
          res.render('groups');
        }
      })
  }
})

app.get('/groups/join', loginCheck, (req, res) => {
  res.render('groups-join')
})

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
          console.log(DBTasksObj['task_info'])
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

app.post("/failed/list/:listID", (req, res) => {
  // user will be routed here is they take > 25min to complete a tasklist
  // DO NOT update tasklist status - render retry page
  const listID = req.params.listID
  res.render('error', { message: 'please try again~' })
})

app.post("/complete/list/:listID", (req, res) => {
  // query to update tasklist completion status and datetime based on cookie information
  const listID = req.params.listID
  const listCompletionQueryStr = `UPDATE task_lists SET completion_datetime = now(), completion_status = TRUE WHERE id = ${listID}`
  pool
    .query(listCompletionQueryStr)
    .then((result) => {
      // console.log(result)
      res.clearCookie('sessionTasks') // delete tasks cookie
      res.cookie('lastSession', listID) // create new cookie for prev session
      // to add report for last session in EJS
      // this probably needs a fix to include the data object, or to split into 2 separate EJS pages (1 POST, 1 GET)
    })
    .then(() => {
      const listQueryStr = `SELECT * FROM task_lists WHERE id = ${listID}`
      const taskQueryStr = `SELECT id, task_name, completion_status, completion_datetime - created_at AS duration FROM tasks where list_id = ${listID} ORDER BY id ASC`
      const groupQueryStr = `SELECT users.user_name, users.id, users.groupid FROM users INNER JOIN task_lists ON task_lists.assigned_user = users.id WHERE task_lists.id = ${listID}`

      const results = Promise.all([
        pool.query(listQueryStr),
        pool.query(taskQueryStr),
        pool.query(groupQueryStr)
      ])

      results.then((combinedResults) => {
        const [ listQueryResults, taskQueryResults, groupQueryResults ] = combinedResults;
        const listData = listQueryResults.rows
        const taskData = taskQueryResults.rows
        const userData = groupQueryResults.rows

        // taskdata contains a PostgresInterval object that has the properties of minutes, seconds, and milliseconds
        // we will only use minutes and seconds for our purpouses
        // this can be accessed from listSummaryObj['taskData'][i]['duration']['minutes']
        const listSummaryObj = {listData, taskData, userData}

        // ensures that edit/delete buttons only appear for the owning logged-in user
        if(req.cookies.userID == userData[0]['id']){
          listSummaryObj['userEditStatus'] = true
          // console.log(listSummaryObj)
        } else {
          listSummaryObj['userEditStatus'] = false
        }
        res.render('tasks-complete', listSummaryObj);
  })
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
  const groupQueryStr = `SELECT users.user_name, users.id, users.groupid FROM users INNER JOIN task_lists ON task_lists.assigned_user = users.id WHERE task_lists.id = ${requestedListID}`

  const results = Promise.all([
    pool.query(listQueryStr),
    pool.query(taskQueryStr),
    pool.query(groupQueryStr)
  ])

  results.then((combinedResults) => {
    const [ listQueryResults, taskQueryResults, groupQueryResults ] = combinedResults;
    const listData = listQueryResults.rows
    const taskData = taskQueryResults.rows
    const userData = groupQueryResults.rows

    // taskdata contains a PostgresInterval object that has the properties of minutes, seconds, and milliseconds
    // we will only use minutes and seconds for our purpouses
    // this can be accessed from listSummaryObj['taskData'][i]['duration']['minutes']
    const listSummaryObj = {listData, taskData, userData}

    // ensures that edit/delete buttons only appear for the owning logged-in user
    if(req.cookies.userID == userData[0]['id']){
      listSummaryObj['userEditStatus'] = true
      // console.log(listSummaryObj)
    } else {
      listSummaryObj['userEditStatus'] = false
    }
    
    res.render('tasks-complete', listSummaryObj);
  })
})

app.put('/complete/list/:listID/edit', (req, res) => {
  // check if user if allowed to edit page (check if assigned user)
  // open a modal to edit the task descriptions
})

app.delete('/complete/list/:listID/delete', (req, res) => {
  // check if user if allowed to edit page (check if assigned user)
  // render confirmation modal
  // query to delete data
  // redirect to home/profile page
})

app.get("/complete/last", (req, res) => {
  // redirect to list page based on laastSession cookie
  const latestTasklistID = req.cookies.lastSession
  res.redirect(`/complete/list/${latestTasklistID}`)
})

// i should make a logout button
app.get('/logout', (req, res) => {
  res.clearCookie('userIdHash')
  res.clearCookie('userID')
  res.redirect('/')
})

app.get('/profile', loginCheck, (req, res) => {
  if (req.isUserLoggedIn === false) { // test from loginCheck middleware
    res.status(403).send('please log in.');
  } else {
    res.redirect(`/profile/view/${req.cookies.userID}`) // automatically send user to their own page
  }
})

app.get('/profile/view/:userID', (req, res) => {
  const requestedUserID = req.params.userID
  const userHistoryQueryStr = `SELECT * FROM task_lists WHERE assigned_user = ${requestedUserID}`;
  const userDataQueryStr = `SELECT user_name, first_name, last_name from users WHERE id = ${requestedUserID}`;

// i know having lots of long queries is a dumb way to pull data
// probably
// but idk so i'll fix it later
// might be able to use a loop to generate the query strings??

  const tMinusOneWeekStatsQueryStr = `
  SELECT count(1), 
  extract('epoch' from (sum(tasks.completion_datetime - tasks.created_at))) 
  FROM tasks  
  INNER JOIN task_lists ON tasks.list_id = task_lists.id
  INNER JOIN users ON task_lists.assigned_user = users.id
  WHERE users.id = ${requestedUserID} 
  AND (tasks.created_at BETWEEN current_date - 7 AND current_date - 1) 
  AND tasks.completion_status = true;
  `
  const tMinus0StatsQueryStr = `
  SELECT count(1), 
  extract('epoch' from (sum(tasks.completion_datetime - tasks.created_at))) 
  FROM tasks 
  INNER JOIN task_lists ON tasks.list_id = task_lists.id
  INNER JOIN users ON task_lists.assigned_user = users.id
  WHERE users.id  = ${requestedUserID} 
  AND (tasks.created_at BETWEEN current_date - 1 AND now())
  AND tasks.completion_status = true;
  `
 
  const tMinus1StatsQueryStr = `
  SELECT count(1), 
  extract('epoch'from (sum(tasks.completion_datetime - tasks.created_at))) 
  FROM tasks  
  INNER JOIN task_lists ON tasks.list_id = task_lists.id
  INNER JOIN users ON task_lists.assigned_user = users.id
  WHERE users.id  = ${requestedUserID} 
  AND (tasks.created_at BETWEEN current_date - 2 AND current_date - 1)
  AND tasks.completion_status = true;
  `
  const tMinus2StatsQueryStr = `
  SELECT count(1), 
  extract('epoch'from (sum(tasks.completion_datetime - tasks.created_at))) 
  FROM tasks  
  INNER JOIN task_lists ON tasks.list_id = task_lists.id
  INNER JOIN users ON task_lists.assigned_user = users.id
  WHERE users.id  = ${requestedUserID} 
  AND (tasks.created_at BETWEEN current_date - 3 AND current_date - 2)
  AND tasks.completion_status = true;
  `

  const tMinus3StatsQueryStr = `
  SELECT count(1), 
  extract('epoch'from (sum(tasks.completion_datetime - tasks.created_at))) 
  FROM tasks  
  INNER JOIN task_lists ON tasks.list_id = task_lists.id
  INNER JOIN users ON task_lists.assigned_user = users.id
  WHERE users.id  = ${requestedUserID} 
  AND (tasks.created_at BETWEEN current_date - 4 AND current_date - 3)
  AND tasks.completion_status = true;
  `

  const tMinus4StatsQueryStr = `
  SELECT count(1), 
  extract('epoch'from (sum(tasks.completion_datetime - tasks.created_at))) 
  FROM tasks  
  INNER JOIN task_lists ON tasks.list_id = task_lists.id
  INNER JOIN users ON task_lists.assigned_user = users.id
  WHERE users.id  = ${requestedUserID} 
  AND (tasks.created_at BETWEEN current_date - 5 AND current_date - 4)
  AND tasks.completion_status = true;
  `

  const tMinus5StatsQueryStr = `
  SELECT count(1), 
  extract('epoch'from (sum(tasks.completion_datetime - tasks.created_at))) 
  FROM tasks  
  INNER JOIN task_lists ON tasks.list_id = task_lists.id
  INNER JOIN users ON task_lists.assigned_user = users.id
  WHERE users.id  = ${requestedUserID} 
  AND (tasks.created_at BETWEEN current_date - 6 AND current_date - 5)
  AND tasks.completion_status = true;
  `

  const tMinus6StatsQueryStr = `
  SELECT count(1), 
  extract('epoch'from (sum(tasks.completion_datetime - tasks.created_at))) 
  FROM tasks  
  INNER JOIN task_lists ON tasks.list_id = task_lists.id
  INNER JOIN users ON task_lists.assigned_user = users.id
  WHERE users.id  = ${requestedUserID} 
  AND (tasks.created_at BETWEEN current_date - 7 AND current_date - 6)
  AND tasks.completion_status = true;
  `

  const results = Promise.all([
  pool.query(userHistoryQueryStr),
  pool.query(userDataQueryStr),

  // every query below this is just pulling stats
  pool.query(tMinusOneWeekStatsQueryStr),
  pool.query(tMinus0StatsQueryStr),
  pool.query(tMinus1StatsQueryStr),
  pool.query(tMinus2StatsQueryStr),
  pool.query(tMinus3StatsQueryStr),
  pool.query(tMinus4StatsQueryStr),
  pool.query(tMinus5StatsQueryStr),
  pool.query(tMinus6StatsQueryStr)
  ])

  results.then((combinedResults) => {
    const [ historyResults, userResults, statsResults, tMinus0Results, tMinus1Results, tMinus2Results, tMinus3Results, tMinus4Results, tMinus5Results, tMinus6Results] = combinedResults
    const userTasks = historyResults.rows
    const userData = userResults.rows[0]
    // userweekly stats is not fed into the profile EJS yet, as it is not included in the userSummaryObj
    const userWeeklyStats = statsResults.rows

    // daily stats compilation and processing
    const minus0Stats = tMinus0Results.rows
    const minus1Stats = tMinus1Results.rows
    const minus2Stats = tMinus2Results.rows
    const minus3Stats = tMinus3Results.rows
    const minus4Stats = tMinus4Results.rows
    const minus5Stats = tMinus5Results.rows
    const minus6Stats = tMinus6Results.rows

    const rawDailyStatsArr = [minus6Stats, minus5Stats, minus4Stats, minus3Stats, minus2Stats, minus1Stats, minus0Stats]
    const flattenedDailyStatsArr = rawDailyStatsArr.map((resultsArr) => {
      return resultsArr[0]
    })
    const dailyTasksCompletedStatsArr = getChartDataArr(flattenedDailyStatsArr, 'count');
    const millisecTimeStatsArr = getChartDataArr(flattenedDailyStatsArr, 'date_part'); // should divide this by 1000 to get seconds
    const dailyTimeStatsArr = millisecTimeStatsArr.map((millisecondElement) => {
      return millisecondElement/1000
    })

    // math to calculate completion stats
    const numOfCreatedLists = userTasks.length;
    const completedListsArr = userTasks.filter((listObj) => {
      return listObj['completion_status'] == true
    })
    const numOfCompletedLists = completedListsArr.length
    const percentageListCompletion = Math.round((numOfCompletedLists/numOfCreatedLists)*100) // round percentage to nearest integer
    const userStats = { numOfCreatedLists, percentageListCompletion}
    const chartStats = { dailyTasksCompletedStatsArr, dailyTimeStatsArr }
    const userSummaryObj = { userTasks, userData, userStats, chartStats }
    // console.log(chartStats)
    res.render('profile', userSummaryObj)
  })
})

app.listen(3000, () => console.log('Server Started'))