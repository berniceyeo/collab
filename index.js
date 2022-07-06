// NPM PACKAGES
import express from "express";
import moment from "moment";
import methodOverride from "method-override";
import cookieParser from "cookie-parser";

import dotenv from "dotenv";
import path from "path";
import pool from "./helperfunctions/pool.js";

// HELPER FUNCTIONS
// checks if the login is authentic
import authenticate from "./helperfunctions/authenticate.js";
// to create an object on the form validations
import { validateForm, createEmpty } from "./helperfunctions/formvalidation.js";
// creates an hashed string
import getHash from "./helperfunctions/hashsession.js";
// slices an array into respective arrays, for forms to seperate tasks
import {
  sliceIntoChunks,
  sliceForEdit,
} from "./helperfunctions/subtaskhandler.js";
// get username and photo
import getDetails from "./helperfunctions/userdetails.js";
// will sort an object by the name of the keys
import dynamicSort from "./helperfunctions/sorting.js";
// will add properites to the array string
import addSentProperty from "./helperfunctions/addSent.js";
// will check if the task is over due or not
import checkDueDate from "./helperfunctions/checkOverdue.js";

// CREATING THE APP
const app = express();
const PORT = process.env.PORT || 3004;

// configure env variables
const envFilePath = ".env";
dotenv.config({ path: path.normalize(envFilePath) });

app.set("view engine", "ejs");
app.use(methodOverride("_method"));
// Add express.static config to allow Express to serve files from public folder
app.use(express.static("public"));
// Add express.static config to allow Express to serve files from uploads folder
app.use(express.static("uploads"));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

const s3 = new aws.S3({
  accessKeyId: process.env.ACCESSKEYID,
  secretAccessKey: process.env.SECRETACCESSKEY,
});

// EJS PAGES
// Log in page
app.get("/", (req, res) => {
  const validate = validateForm(
    "",
    "",
    "Enter valid password",
    "Enter valid email"
  );
  res.render("login", validate);
});

// Submit login details
app.post("/", async (req, res) => {
  try {
    const user = { ...req.body };
    const checkEmail = await pool.query(
      `SELECT * FROM users WHERE email='${user.email}'`
    );

    if (checkEmail.rows.length === 0) {
      throw new Error("email does not exist");
    }

    const storedUser = checkEmail.rows[0];
    // check if password is correct
    const hashedUserPassword = getHash(user.password);

    if (storedUser.password !== hashedUserPassword) {
      throw new Error("incorrect password");
    } else {
      res.cookie("username", storedUser.name);
      res.cookie("userId", storedUser.id);
      res.cookie("hashedSession", getHash(storedUser.id));
      res.redirect("/projects");
    }
  } catch (error) {
    let validate;
    if (error.message === "email does not exist") {
      validate = validateForm(
        "is-invalid",
        "",
        "Enter valid password",
        "Email does not exists! Please sign up"
      );
    } else if (error.message === "incorrect password") {
      validate = validateForm("is-valid", "is-invalid", "Wrong Password", "");
    }
    res.render("login", validate);
  }
});

app.get("/logout", (req, res) => {
  res.clearCookie("username");
  res.clearCookie("userId");
  res.clearCookie("hashedSession");
  res.redirect("/");
});

// signup page
app.get("/signup", (req, res) => {
  const validate = validateForm(
    "",
    "",
    "Enter valid password",
    "Enter valid email"
  );
  res.render("signup", validate);
});

// create a new user, signing up
app.post("/signup", async (req, res) => {
  try {
    const user = { ...req.body };
    const checkEmail = await pool.query(
      `SELECT * FROM users WHERE email='${user.email}'`
    );

    if (checkEmail.rows.length > 0) {
      throw new Error("registered email");
    }

    const hashedPassword = getHash(user.password);
    const values = [user.name, user.email, hashedPassword];
    await pool.query(
      "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id",
      values
    );
    res.redirect("/");
  } catch (error) {
    if (error.message === "registered email") {
      const validate = validateForm(
        "is-invalid",
        "",
        "Enter valid password",
        "Email has already been registered"
      );
      res.render("signup", validate);
    }
  }
});

// user profile
app.get("/profile", authenticate, getDetails, async (req, res) => {
  const { navbar, userId } = req;
  const user = await pool.query(`SELECT * FROM users WHERE id=${userId}`);
  res.render("profile", { navbar, user: user.rows[0] });
});

app.post(
  "/profile/:id/photo",
  authenticate,
  multerUpload.single("photo"),
  async (req, res) => {
    try {
      const userId = Number(req.params.id);
      await pool.query(
        `UPDATE users SET photo='${req.file.location}' WHERE id=${userId}`
      );
      res.redirect("/profile");
    } catch (error) {
      console.log("Error executing query", error);
    }
  }
);

// Edit the profile of the user
app.put(
  "/profile/:id",
  authenticate,
  multerUpload.single("photo"),
  async (req, res) => {
    try {
      const userId = Number(req.params.id);
      const user = req.body;
      await pool.query(
        `UPDATE users SET name='${user.name}', email='${user.email}', contact='${user.contact}', role='${user.role}', workplace='${user.workplace}' WHERE id=${userId}`
      );
      res.redirect("/profile");
    } catch (error) {
      console.log("Error executing query", error.stack);
      res.status(503).send(res.rows);
    }
  }
);

// user profile
app.get("/teammates", authenticate, getDetails, async (req, res) => {
  const { navbar, userId } = req;
  const friends = await pool.query(
    `SELECT * FROM users INNER JOIN friends ON users.id = friends.friend_id WHERE friends.user_id=${userId}`
  );
  res.render("teammates", {
    navbar,
    friends: friends.rows,
    mailvalid: "",
    invalid: "",
  });
});

app.post("/teammates/add", authenticate, getDetails, async (req, res) => {
  const { navbar, userId } = req;
  const user = req.body;
  try {
    const checkEmail = await pool.query(
      `SELECT * FROM users WHERE email='${user.sendeeemail}'`
    );
    if (checkEmail.rows.length === 0) {
      throw new Error("email does not exist");
    }
    const receiptID = checkEmail.rows[0].id;
    const checkFriends = await pool.query(
      `SELECT * FROM users INNER JOIN friends ON users.id = friends.friend_id WHERE friends.user_id=${userId} AND friends.friend_id=${receiptID} `
    );
    if (checkFriends.rows.length > 0) {
      throw new Error("friend exists");
    }
    await pool.query(
      `INSERT INTO friends (user_id, friend_id) VALUES ( ${userId}, ${receiptID} )`
    );
    res.redirect("/teammates");
  } catch (error) {
    const finalResults = await pool.query(
      `SELECT * FROM users INNER JOIN friends ON users.id = friends.friend_id WHERE friends.user_id=${userId}`
    );

    if (error.message === "friend exists") {
      res.render("teammates", {
        navbar,
        friends: finalResults.rows,
        invalid: "friend already exists",
        mailvalid: "is-invalid",
      });
    } else if (error.message === "email does not exist") {
      res.render("teammates", {
        navbar,
        friends: finalResults.rows,
        invalid: "Email does not belong to any user",
        mailvalid: "is-invalid",
      });
    }
  }
});

app.delete("/teammates/:id", authenticate, async (req, res) => {
  const { userId } = req;
  const friendId = Number(req.params.id);
  await pool.query(
    `DELETE FROM friends WHERE friend_id=${friendId} AND user_id=${userId}`
  );
  res.redirect("/teammates");
});

// page to show all the projects
app.get("/projects", authenticate, getDetails, async (req, res) => {
  const { navbar, userId } = req;
  const { completedSortBy } = req.query;
  const { pendingSortBy } = req.query;

  const unsortedcompletedProj = await pool.query(
    `SELECT * FROM proj WHERE created_by = ${userId} AND status='pending'`
  );
  const unsortedpendingProj = await pool.query(
    `SELECT * FROM proj WHERE created_by = ${userId} AND status ='completed'`
  );
  const pendingProj = dynamicSort(pendingSortBy, unsortedcompletedProj.rows);
  const completedProj = dynamicSort(completedSortBy, unsortedpendingProj.rows);
  res.render("projects", { pendingProj, completedProj, navbar });
});

// form to add a project
app.get("/projects/add", authenticate, getDetails, async (req, res) => {
  const { navbar, userId } = req;
  const friends = await pool.query(
    `SELECT * FROM users INNER JOIN friends ON users.id = friends.friend_id WHERE friends.user_id=${userId}`
  );
  res.render("createproject", { navbar, friends: friends.rows });
});

// to post new project and tasks
app.post("/projects/add", authenticate, getDetails, async (req, res) => {
  const { navbar, userId } = req;
  const user = req.body;
  const [name, description, duedate, ...tasks] = Object.values(user);
  const slicedArray = sliceIntoChunks(tasks);
  const validationArray = createEmpty(slicedArray);
  const fomattedDueDate = moment(duedate).format("DD MMM YYYY hh:mm");
  const values = [name, description, fomattedDueDate, "pending", 0, userId];

  try {
    const insertProj = await pool.query(
      "INSERT INTO proj (name, description, due_date, status, progress, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
      values
    );
    const projId = insertProj.rows[0].id;

    // do validation for emails first
    slicedArray.forEach(async (chunk, index) => {
      const [taskName, taskduedate, email] = chunk;
      const formattedTDueDate = moment(taskduedate).format("DD MMM YYYY hh:mm");
      const users = await pool.query(
        `SELECT * FROM users WHERE email='${email}'`
      );
      // if the email is invalid
      if (users.rows.length === 0) {
        await pool.query(`DELETE FROM proj WHERE id=${projId}`);
        validationArray[index] = "is-invalid";
        const object = { ...user, validation: validationArray };
        res.render("createprojectvalidate", { ...object, navbar });
        throw new Error("email is invalid");
      }
      const receiptId = users.rows[0].id;
      const insertTasks = await pool.query(
        "INSERT INTO tasks (name, due_date, accepted, status, created_by) VALUES ( $1, $2, $3, $4, $5) RETURNING id",
        [taskName, formattedTDueDate, "no", "pending", userId]
      );
      const taskId = insertTasks.rows[0].id;
      console.log("projId", projId);
      await pool.query(
        "INSERT INTO user_tasks (user_id, task_id) VALUES ($1, $2)",
        [receiptId, taskId]
      );
      await pool.query(
        "INSERT INTO proj_tasks (proj_id, task_id) VALUES ($1, $2)",
        [projId, taskId]
      );
      await pool.query(
        "INSERT INTO messages (send_to, task_id, accept) VALUES ($1, $2, $3)",
        [receiptId, taskId, "pending"]
      );
    });
    res.redirect("/projects");
  } catch (error) {
    console.log(error);
  }
});

// to get the page for the individual project with id
app.get("/projects/:id", authenticate, getDetails, async (req, res) => {
  try {
    const projId = Number(req.params.id);
    const { navbar } = req;
    const proj = await pool.query(`SELECT * FROM proj WHERE id= ${projId}`);
    console.log(proj.rows);
    const tasks = await pool.query(
      `SELECT user_tasks.user_id, user_tasks.task_id, proj_tasks.proj_id, proj_tasks.task_id, tasks.id, tasks.name, tasks.due_date, tasks.accepted, tasks.status, tasks.created_by, users.name AS username FROM user_tasks INNER JOIN proj_tasks ON proj_tasks.task_id = user_tasks.task_id INNER JOIN tasks ON user_tasks.task_id = tasks.id INNER JOIN users ON user_tasks.user_id = users.id WHERE proj_id=${projId}`
    );
    res.render("individualproj", {
      proj: proj.rows[0],
      tasks: tasks.rows,
      navbar,
    });
  } catch (error) {
    console.log("Error executing query", error.stack);
    res.status(503).send(res.rows);
  }
});

// to get the form to edit the project
app.get("/projects/:id/edit", authenticate, getDetails, async (req, res) => {
  const projId = Number(req.params.id);
  const { navbar } = req;
  try {
    const getTasks = await pool.query(
      `SELECT tasks.id AS taskid, tasks.name, tasks.due_date, tasks.accepted, tasks.status, tasks.created_by, proj_tasks.proj_id, proj_tasks.task_id, user_tasks.user_id, user_tasks.task_id FROM tasks INNER JOIN proj_tasks ON proj_tasks.task_id = tasks.id INNER JOIN user_tasks ON user_tasks.task_id = tasks.id WHERE proj_tasks. proj_id = ${projId}`
    );
    const tasks = getTasks.rows;
    const updatedTasks = [];
    tasks.forEach(async (task) => {
      const receiptId = task.user_id;
      const users = await pool.query(
        `SELECT * FROM users WHERE id=${receiptId}`
      );
      const userEmail = users.rows[0].email;
      task.user_email = userEmail;
      task.formatdate = moment(task.due_date).format("YYYY-MM-DDTHH:MM");
      updatedTasks.push(task);
    });
    const getProj = await pool.query(`SELECT * FROM proj WHERE id= ${projId}`);
    const proj = getProj.rows[0];
    proj.formatdate = moment(proj.due_date).format("YYYY-MM-DDTHH:MM");
    res.render("editproject", { proj, tasks: updatedTasks, navbar });
  } catch (error) {
    console.log("Error executing query", error);
  }
});

// to edit the details
app.put("/projects/:id/edit", authenticate, async (req, res) => {
  const { userId } = req;
  const user = req.body;
  const projId = req.params.id;
  const [name, description, duedate, ...tasks] = Object.values(user);
  const fomattedDueDate = moment(duedate).format("DD MMM YYYY hh:mm");

  try {
    await pool.query(
      `UPDATE proj SET name ='${name}', description='${description}', due_date='${fomattedDueDate}' WHERE id=${projId}`
    );

    const slicedArray = sliceForEdit(tasks);
    slicedArray.forEach(async (chunk) => {
      const [taskId, taskName, taskduedate, email] = chunk;
      const formattedTDueDate = moment(taskduedate).format("DD MMM YYYY hh:mm");
      const getUsers = await pool.query(
        `SELECT * FROM users WHERE email='${email}'`
      );
      const receiptId = Number(getUsers.rows[0].id);
      const query = "";
      if (taskId === "") {
        const insertTask = await pool.query(
          `INSERT INTO tasks (name, due_date, accepted, status, created_by) VALUES ('${taskName}', '${formattedTDueDate}', 'no', 'pending', ${userId}) RETURNING id`
        );
        const newTaskId = Number(insertTask.rows[0].id);
        await pool.query(
          `INSERT INTO user_tasks (user_id, task_id) VALUES ('${receiptId}', '${newTaskId}') RETURNING id`
        );
        await pool.query(
          `INSERT INTO proj_tasks (proj_id, task_id) VALUES (${projId}, ${newTaskId}) RETURNING id`
        );
        await pool.query(
          `INSERT INTO messages (send_to, task_id, accept) VALUES ('${receiptId}', '${newTaskId}', 'pending') RETURNING id`
        );
      } else {
        await pool.query(
          `UPDATE tasks SET name ='${taskName}', due_date='${formattedTDueDate}' WHERE id=${taskId}`
        );
        await pool.query(
          `UPDATE user_tasks SET user_id ='${receiptId}' WHERE id='${taskId}'`
        );
        await pool.query(
          `UPDATE proj_tasks SET proj_id ='${projId}' WHERE id=${taskId}`
        );
      }
    });
    res.redirect(`/projects/${projId}`);
  } catch (error) {
    console.log(error);
  }
});

// delete the project and relevant tasks
app.delete("/projects/:id", async (req, res) => {
  try {
    const projId = Number(req.params.id);
    const projTasks = await pool.query(
      `SELECT * FROM proj_tasks WHERE proj_id = ${projId}`
    );
    const tasks = projTasks.rows;
    tasks.forEach(async (task) => {
      const taskId = task.id;
      await pool.query(`DELETE FROM tasks WHERE id=${taskId}`);
      await pool.query(`DELETE FROM user_tasks WHERE task_id=${taskId}`);
      await pool.query(`DELETE FROM messages WHERE task_id=${taskId}`);
    });
    await pool.query(`DELETE FROM proj WHERE id=${projId}`);
    await pool.query(`DELETE FROM proj_tasks WHERE proj_id=${projId}`);
    res.redirect("/projects/");
  } catch (error) {
    console.log(error);
  }
});

// to update tasks to be completed and update progress of the project
app.get("/tasks/completed", authenticate, async (req, res) => {
  const { projId, taskId, taskStatus } = req.query;
  try {
    await pool.query(
      `UPDATE tasks SET status='${taskStatus}' WHERE id=${taskId}`
    );
    const tasks = await pool.query(
      `SELECT * FROM proj_tasks WHERE proj_id=${projId}`
    );
    const completed = await pool.query(
      `SELECT * FROM tasks INNER JOIN proj_tasks ON proj_tasks.task_id = tasks.id WHERE proj_tasks.proj_id = ${projId} AND tasks.status = 'completed'`
    );
    const totalTasks = tasks.rows.length;
    const completedTasks = completed.rows.length;
    let progress = 0;
    if (completedTasks === 0) {
      progress = 0;
    } else {
      progress = Math.floor((completedTasks / totalTasks) * 100);
    }

    let progressStatus = "";
    if (progress === 100) {
      progressStatus = "completed";
    } else {
      progressStatus = "pending";
    }

    await pool.query(
      `UPDATE proj SET progress = ${progress}, status='${progressStatus}'  WHERE id=${projId}`
    );
    res.redirect(`/projects/${projId}`);
  } catch (error) {
    console.log(error);
  }
});

// to get ALL tasks
app.get("/tasks/all", authenticate, getDetails, async (req, res) => {
  const { navbar, userId } = req;
  const { pendingSortBy } = req.query;
  const { completedSortBy } = req.query;
  try {
    const completed = await pool.query(
      `SELECT tasks.id, tasks.name, tasks.due_date, tasks.accepted, tasks.status, tasks.created_by, proj_tasks.proj_id, proj_tasks.task_id, user_tasks.user_id, user_tasks.task_id, users.name AS username  FROM tasks INNER JOIN proj_tasks ON proj_tasks.task_id = tasks.id INNER JOIN user_tasks on user_tasks.task_id = tasks.id INNER JOIN users ON tasks.created_by = users.id WHERE user_tasks.user_id = ${userId} AND tasks.status='completed' AND tasks.accepted='accepted'`
    );

    const pending = await pool.query(
      `SELECT tasks.id, tasks.name, tasks.due_date, tasks.accepted, tasks.status, tasks.created_by, proj_tasks.proj_id, proj_tasks.task_id, user_tasks.user_id, user_tasks.task_id, users.name AS username  FROM tasks INNER JOIN proj_tasks ON proj_tasks.task_id = tasks.id INNER JOIN user_tasks on user_tasks.task_id = tasks.id INNER JOIN users ON tasks.created_by = users.id WHERE user_tasks.user_id = ${userId} AND tasks.status='pending' AND tasks.accepted='accepted'`
    );

    const unsortedcompletedTasks = completed.rows;
    const unsortedpendingTasks = pending.rows;
    const checkpendingTasks = dynamicSort(pendingSortBy, unsortedpendingTasks);
    const pendingTasks = checkDueDate(checkpendingTasks);
    const completedTasks = dynamicSort(completedSortBy, unsortedcompletedTasks);
    res.render("tasks", { completedTasks, pendingTasks, navbar });
  } catch (error) {
    console.log(error);
  }
});

// to update tasks to be completed and update progress of the project
app.get("/tasks/all/completed", authenticate, async (req, res) => {
  try {
    const { projId, taskId, taskStatus } = req.query;

    await pool.query(
      `UPDATE tasks SET status='${taskStatus}' WHERE id=${taskId}`
    );
    const pending = await pool.query(
      `SELECT * FROM proj_tasks WHERE proj_id=${projId}`
    );
    const totalTasks = pending.rows.length;
    const completed = await pool.query(
      `SELECT * FROM tasks INNER JOIN proj_tasks ON proj_tasks.task_id = tasks.id WHERE proj_tasks.proj_id = ${projId} AND tasks.status = 'completed'`
    );
    const completedTasks = completed.rows.length;

    let progress = 0;

    if (completedTasks === 0) {
      progress = 0;
    } else {
      progress = Math.floor((completedTasks / totalTasks) * 100);
    }

    let progressStatus = "";
    if (progress === 100) {
      progressStatus = "completed";
    } else {
      progressStatus = "pending";
    }

    await pool.query(
      `UPDATE proj SET progress = ${progress}, status='${progressStatus}' WHERE id=${projId}`
    );
    res.redirect("/tasks/all");
  } catch (error) {
    console.log("error");
  }
});

// to get the form on whether they want to accept the task
app.get("/task/:id/accept", authenticate, getDetails, async (req, res) => {
  const { id } = req.params;
  const { navbar } = req;
  try {
    const accepttasks = await pool.query(
      `SELECT tasks.name, tasks.id AS taskid, tasks.due_date, tasks.accepted, tasks.status, tasks.created_by, users.name AS username, users.id, users.email, messages.id AS messagesId, messages.accept, messages.task_id, messages.send_to FROM tasks INNER JOIN messages ON messages.task_id = tasks.id INNER JOIN users ON tasks.created_by= users.id WHERE messages.id= ${id}`
    );
    res.render("accepttasks", { task: accepttasks.rows[0], navbar });
  } catch (error) {
    console.log("Error executing query", error);
  }
});

// to post their response to whether they accepted
app.post("/task/:id/accept", authenticate, async (req, res) => {
  const messageId = Number(req.params.id);
  const { accept } = req.body;
  try {
    const messages = await pool.query(
      `SELECT * FROM messages WHERE id=${messageId}`
    );
    const taskId = Number(messages.rows[0].task_id);
    await pool.query(
      `UPDATE tasks SET accepted ='${accept}' WHERE id=${taskId}`
    );
    await pool.query(
      `UPDATE messages SET accept='${accept}' WHERE id=${messageId}`
    );
    res.redirect("/inbox");
  } catch (error) {
    console.log("Error executing query", error.stack);
    res.status(503).send(res.rows);
  }
});

// to get the email that allow user to resend tasks
app.get("/task/:id/resend", authenticate, getDetails, async (req, res) => {
  try {
    const { id } = req.params;
    const { navbar } = req;
    const resendTasks = await pool.query(
      `SELECT tasks.name, tasks.id AS taskid, tasks.due_date, tasks.accepted, tasks.status, tasks.created_by, users.name AS username, users.id, users.email, messages.id AS messagesId, messages.accept, messages.task_id, messages.send_to FROM messages INNER JOIN tasks ON messages.task_id = tasks.id INNER JOIN users ON users.id= messages.send_to WHERE messages.id= ${id}`
    );
    res.render("resendtasks", {
      task: resendTasks.rows[0],
      navbar,
      mailvalid: "",
    });
  } catch (error) {
    console.log("Error executing query", error);
  }
});

// to change the user that is assigned the task after task has been rejected
app.put("/task/:id/resend", authenticate, getDetails, async (req, res) => {
  const id = Number(req.params.id);
  const { navbar } = req;
  const { sendeeemail } = req.body;
  try {
    const users = await pool.query(
      `SELECT * FROM users WHERE email='${sendeeemail}'`
    );
    if (users.rows.length === 0) {
      throw new Error("user does not exist");
    } else {
      const receiptID = Number(users.rows[0].id);
      await pool.query(
        `UPDATE user_tasks SET user_id= ${receiptID} WHERE task_id=${id}`
      );
      await pool.query(
        `INSERT INTO messages (send_to, task_id, accept) VALUES ('${receiptID}', '${id}', 'pending')`
      );
      await pool.query(`UPDATE tasks SET accepted='no' WHERE id=${id}`);
      res.redirect("/inbox");
    }
  } catch (error) {
    const tasks = await pool.query(
      `SELECT name, id AS taskid, due_date, accepted, status, created_by FROM tasks WHERE id=${id}`
    );
    if (error.message === "user does not exist") {
      const task = tasks.rows[0];
      // sends back to the form modal that the email input is invalid
      res.render("resendtasks", { navbar, task, mailvalid: "is-invalid" });
    }
  }
});

// to see their inbox
app.get("/inbox", authenticate, getDetails, async (req, res) => {
  const { navbar, userId } = req;
  const { sortBy } = req.query;
  try {
    const prereceivedTasks = await pool.query(
      `SELECT tasks.name, tasks.id, tasks.due_date, tasks.accepted, tasks.status, tasks.created_by, messages.accept, messages.task_id, messages.id AS messagesId, messages.send_to, users.name AS username, users.id, users.email FROM tasks INNER JOIN users ON tasks.created_by = users.id INNER JOIN messages ON messages.task_id = tasks.id WHERE messages.send_to='${userId}'`
    );
    const receivedTasks = addSentProperty(prereceivedTasks.rows, "received");
    const presentTasks = await pool.query(
      `SELECT tasks.name, tasks.id, tasks.due_date, tasks.accepted, tasks.status, tasks.created_by, messages.accept, messages.task_id, users.name AS username, users.id, users.email, messages.send_to, messages.id AS messagesId FROM messages INNER JOIN tasks ON messages.task_id = tasks.id INNER JOIN users ON messages.send_to = users.id WHERE tasks.created_by='${userId}'`
    );
    const sentTasks = addSentProperty(presentTasks.rows, "sent");
    const pretotalTasks = [...receivedTasks, ...sentTasks];
    const totalTasks = dynamicSort(sortBy, pretotalTasks);

    res.render("inbox", {
      totalTasks,
      navbar,
      inboxId: userId,
    });
  } catch (error) {
    console.log("Error executing query", error.stack);
    res.status(503).send(res.rows);
  }
});

app.listen(PORT);
