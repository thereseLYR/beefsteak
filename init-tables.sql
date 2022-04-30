CREATE TABLE users(
  id SERIAL PRIMARY KEY,
  user_name TEXT, 
  first_name TEXT, 
  last_name TEXT, 
  email TEXT, 
  password TEXT, 
  groupID INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE groups(
  id SERIAL PRIMARY KEY,
  group_name TEXT,
  owner_id INTEGER,
  group_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE task_lists(
  id SERIAL PRIMARY KEY,
  owner_group INTEGER,
  assigned_user INTEGER,
  list_name TEXT,
  list_description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completion_status BOOLEAN,
  completion_datetime TIMESTAMP
);

CREATE TABLE tasks(
  id SERIAL PRIMARY KEY,
  list_id INTEGER,
  task_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completion_status BOOLEAN,
  completion_datetime TIMESTAMP
);