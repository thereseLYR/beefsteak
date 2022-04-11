DROP TABLE IF EXISTS users;

DROP TABLE IF EXISTS groups;
DROP TABLE IF EXISTS task_lists;
DROP TABLE IF EXISTS tasks;

DROP TABLE IF EXISTS comments;

CREATE TABLE users(
  id SERIAL PRIMARY KEY,
  user_name VARCHAR(32), 
  first_name VARCHAR(32), 
  last_name VARCHAR(32), 
  email TEXT, 
  password TEXT, 
  groupID INTEGER
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE families (
  id SERIAL PRIMARY KEY,
  name TEXT,
  main_user_id SERIAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_main_user_id
    FOREIGN KEY(main_user_id)
      REFERENCES users(id)
);


CREATE TABLE groups(
  id SERIAL PRIMARY KEY,
  group_name TEXT,
  owner_id INTEGER,
  group_description TEXT 
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
);

CREATE TABLE budgets (
  id SERIAL PRIMARY KEY,
  name TEXT,
  family_id SERIAL,
  budget_amount DECIMAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_family
    FOREIGN KEY(family_id)
      REFERENCES families(id)
);

CREATE TABLE expenses (
  id SERIAL PRIMARY KEY,
  name TEXT,
  budget_id SERIAL,
  user_id SERIAL,
  expense_amount DECIMAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- CONSTRAINT fk_budget
  --   FOREIGN KEY(budget_id)
  --     REFERENCES budgets(id)
  -- -- beyond MVP, expenses do not need to be tied to a budget
  CONSTRAINT fk_user
    FOREIGN KEY(user_id)
      REFERENCES users(id)
);

CREATE TABLE tags (
  id SERIAL PRIMARY KEY,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE expenses_tags (
  id SERIAL PRIMARY KEY,
  tag_id SERIAL,
  expense_id SERIAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_expense
    FOREIGN KEY(expense_id)
      REFERENCES expenses(id),
  CONSTRAINT fk_tag
    FOREIGN KEY(tag_id)
      REFERENCES tags(id)
);

CREATE TABLE account_approvals (
  id SERIAL PRIMARY KEY,
  main_user_id SERIAL,
  user_id SERIAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_main_user_id
    FOREIGN KEY(main_user_id)
      REFERENCES users(id),
  CONSTRAINT fk_user_id
    FOREIGN KEY(user_id)
      REFERENCES users(id)
);

CREATE DATABASE beefsteak;

CREATE TABLE task_lists(
  list_id SERIAL PRIMARY KEY,
  owner_group INTEGER,
  assigned_user INTEGER,
  list_name VARCHAR(32),
  list_description VARCHAR(255),
  created_at DEFAULT now(),
  completion_status BOOLEAN,
  completion_datetime TIMESTAMP
);

CREATE TABLE tasks(
  task_id SERIAL PRIMARY KEY,
  list_id INTEGER,
  task_name VARCHAR(32),
  created_at DEFAULT now(),
  completion_status BOOLEAN,
  completion_datetime TIMESTAMP
);