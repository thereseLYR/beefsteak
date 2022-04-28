import express, { json, query, raw, request } from 'express';
import pg from 'pg';
import methodOverride from 'method-override';
import jsSHA from 'jssha';
import cookieParser from 'cookie-parser';

const PORT = process.env.PORT || 3004;

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
// normally, the salt would be stored as an environment variable so it is not directly acessible in code
// for demo purpouses, an empty salt is used
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

/**
 * checks and sets login status to restrict certain routes to unly be usable by logged-in users
 * compares the existing hash cookie to a resh hash of the raw userId cookie to verify that no changes were made by the user
 * @param {*} req - request as sent by client
 * @param {*} res - response as sent by server
 * @param {func} next - next function to execute
 */
const loginCheck = (req, res, next) => {
  if (!req.cookies.userIdHash) {
    res.render('error', { message: 'Please log in to continue.' });
  }
  req.isUserLoggedIn = false; // default value
  const idHash = getHash(req.cookies.userID);
  if(req.cookies.userIdHash === idHash){
    req.isUserLoggedIn = true;
    res.locals.userId = req.cookies.userIdHash; // pass userId of the user into middleware (as hashed).
    app.locals.userId = req.cookies.userId
  }
  next();
};

/**
 *
 *
 * @param {array} statsArr - array of objects which contain a certain target key
 * @param {string} key - key to indicate which values to extract from the input array of objects
 * @return {*} array contianing only the values of the target key as extracted from the input array of objects
 */
const getChartDataArr = function(statsArr, key){
  let newCountArr = [];
  statsArr.forEach((taskObject) => {
    newCountArr.push(taskObject[key])
  })
  return newCountArr
}

/**
 * queries a specified table to check if a particular ID is already in use
 * async to allow the ID check query to complete before subsequent actions are taken after this function is called
 * @param {number} id
 * @param {string} table
 */
const checkIDInTable = async function(id, table){
  const tableQueryStr = `SELECT * from ${table} WHERE id = ${id}`
  let status

  pool
    .query(tableQueryStr)
    .then((results) => {
      if(results.rows.length == 0){
        status = false
      } else {
        status = true
      } return status
    })
}

// routes
app.get('/', (req, res) => {
  if(req.cookies.sessionTasks){
    res.redirect('/inprogress')
  }
  res.render('index')
  })

app.post('/tasklist/list', (req, res) => {
    const inputs = req.body;
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
        // cookie will be used to generate list for users to strike off their tasks
        res.cookie('sessionTasks', taskCookieObj)
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
  .query('SELECT * FROM users WHERE user_name=$1', usernameQueryvalues)
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
    res.cookie('groupID', retrievedUserInfo.groupid)
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
  const userGroupQueryStr = `
  SELECT users.groupid, users.user_name, groups.group_name, groups.group_description FROM users 
  INNER JOIN groups ON groups.id = users.groupid
  WHERE users.id = ${req.cookies.userID};`

  const groupTasksQueryStr = `
  SELECT users.user_name, users.id AS user_id, task_lists.id, task_lists.assigned_user, task_lists.list_name, task_lists.completion_status from users
  INNER JOIN groups ON groups.id = users.groupid
  INNER JOIN task_lists on task_lists.assigned_user = users.id
  WHERE users.groupid = ${req.cookies.groupID};
  `

  pool
    .query(userGroupQueryStr)
    .then((result) => {
      if(result.rows == 0){
        res.redirect('/groups/join');
      } else {
        const usersDataObj = result.rows[0]
        pool
          .query(groupTasksQueryStr)
          .then((result) => {
            const groupTasksData = result.rows
            res.render('groups', { usersDataObj, groupTasks: groupTasksData });
          })
      }
    })
})

app.get('/groups/join', loginCheck, (req, res) => {
  res.render('groups-join')
})

app.post('/groups/join', loginCheck, (req, res) => {
  const groupIdToJoin = Number(req.body['groupId'])

  const addUserToGroupQueryStr = `UPDATE users SET groupid = ${groupIdToJoin} WHERE id = ${req.cookies.userID};`
  const groupExists = checkIDInTable(groupIdToJoin, 'groups');

  if(groupExists){
    pool
      .query(addUserToGroupQueryStr)
      .then((result) => {
        res.cookie('groupID', groupIdToJoin)
        res.redirect('/groups')
      })
      .catch((error) => {
      console.log('ERROR CAUGHT')
      console.log(error.message);
      })
  } else {
    res.render('error', { message: 'Invalid group ID. Please try again.' })
  }
})

app.get('/groups/new', loginCheck, (req, res) => {
  res.render('groups-new')
})

app.post('/groups/new', loginCheck, (req, res) => {
  console.log(req.body)
  const createGroupQueryStr = `INSERT INTO groups (group_name, group_description, owner_id) VALUES ($1, $2, $3) RETURNING id`
  const createGroupQueryValues = [ req.body['group-name'], req.body['group-description'], req.cookies['userID'] ]

  pool
    .query(createGroupQueryStr, createGroupQueryValues)
    .then((results) => {
      console.log('results:', results)
      res.redirect('/groups')
    })
    .catch((error) => {
    console.log('ERROR CAUGHT')
    console.log(error.message);
    })
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
          // console.log(DBTasksObj['task_info'])
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
  // mark list as failed overall, but individual tasks are still completed
  const listID = req.params.listID
  const listFailedQueryStr = `UPDATE task_lists SET completion_status = FALSE WHERE id = ${listID}`
  pool
    .query(listFailedQueryStr)
    .then((result) => {
      res.clearCookie('sessionTasks') // delete tasks cookie
      res.cookie('lastSession', listID) // create new cookie for prev session
      res.redirect(`/complete/list/${listID}`)
    })
})

app.post("/complete/list/:listID", (req, res) => {
  // query to update tasklist completion status and datetime based on cookie information
  const listID = req.params.listID
  const listCompletionQueryStr = `UPDATE task_lists SET completion_datetime = now(), completion_status = TRUE WHERE id = ${listID}`
  pool
    .query(listCompletionQueryStr)
    .then((result) => {
      res.clearCookie('sessionTasks') // delete tasks cookie
      res.cookie('lastSession', listID) // create new cookie for prev session
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

        console.log(userData[0])

        if(!userData[0]){
          userData[0] = {}
          // console.log('guest user detected!')
          userData[0]['id'] = 0
          userData[0]['user_name'] = 'guest'
          // console.log(userData[0])
        }

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

    if(!userData[0]){
          userData[0] = {}
          // console.log('guest user detected!')
          userData[0]['id'] = 0
          userData[0]['user_name'] = 'guest'
          // console.log(userData[0])
        }

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

app.delete('/complete/list/:listID/delete', loginCheck, (req, res) => {
  // buttons for this method are only rendered if user is signed in + owns the tasklist, no additional check if user if allowed to edit page
  const listIdToDelete = req.params.listID
  const listDeletionQuery = `DELETE from task_lists WHERE id = ${listIdToDelete};`
  pool
    .query(listDeletionQuery)
    .then((result) => {
      res.redirect('/profile')
    })
    .catch((error) => {
        console.log('ERROR CAUGHT');
        console.error(error.message);
      })
})

app.get("/complete/last", (req, res) => {
  // redirect to list page based on laastSession cookie
  const latestTasklistID = req.cookies.lastSession
  res.redirect(`/complete/list/${latestTasklistID}`)
})

app.get('/logout', (req, res) => {
  res.clearCookie('userIdHash')
  res.clearCookie('userID')
  res.clearCookie('groupID')
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
// each day interval has its own query, for 7 queries total + 1 weekly overview
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
      return millisecondElement/1000 * 60 // returns time in minutes, numeric
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
    // console.log(userSummaryObj)
    // console.log(chartStats)
    res.render('profile', userSummaryObj)
  })
})

app.listen(PORT, () => console.log('Server Started'))