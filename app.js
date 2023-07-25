const express = require("express");
const path = require("path");

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

const authenticateToken = (request, response, next) => {
  const { tweet } = request.body;
  const { tweetId } = request.params;
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        next();
      }
    });
  }
};

app.post("/register", async (request, response) => {
  const { username, name, password, gender } = request.body;
  const hashedPassword = await bcrypt.hash(request.body.password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);

  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const createUserQuery = `
            INSERT INTO 
                user (username, name, password, gender) 
            VALUES 
                (
                '${username}', 
                '${name}',
                '${hashedPassword}', 
                '${gender}'
               
                )`;
      const dbResponse = await db.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

app.post("/login", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const jwtToken = jwt.sign(dbUser, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { payload } = request;
  const { user_id, username, gender, name } = payload;
  const getTweetsFeedQuery = `
      SELECT 
      username,
      tweet,
      date_time AS dateTime
      FROM 
       follower INNER JOIN tweet ON follower.following_user_id=tweet.user_id INNER JOIN 
       user ON user.user_id =follower.following_user_id
      WHERE 
        follower.follower_user_id = ${user_id}
        ORDER BY 
        date_time DESC
        LIMIT 4
      ;`;
  const tweetFeedArray = await db.all(getTweetsFeedQuery);
  response.send(tweetFeedArray);
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { payload } = request;
  const { user_id, username, gender, name } = payload;
  const userFollowsQuery = `
    SELECT 
        name
    FROM 
       user INNER JOIN follower ON user.user_id = follower.following_user_id
     
      WHERE 
        follower.follower_user_id = ${user_id}
  `;
  const tweetArray = await db.all(userFollowsQuery);
  response.send(tweetArray);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { payload } = request;
  const { user_id, username, gender, name } = payload;
  const userFollowerQuery = `
    SELECT 
        name
    FROM 
       user INNER JOIN follower ON user.user_id = follower.follower_user_id
     
      WHERE 
        follower.following_user_id = ${user_id}
  `;
  const tweetArray = await db.all(userFollowerQuery);
  response.send(tweetArray);
});

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { tweetId } = request;
  const { payload } = request;
  const { user_id, username, gender, name } = payload;

  const tweetQuery = `SELECT * FROM tweet WHERE tweet_id = ${tweetId};`;
  const tweetResult = await db.get(tweetQuery);
  const userFollowerQuery = `
    SELECT 
        *
    FROM 
       follower INNER JOIN  user ON user.user_id = follower.following_user_id
     
      WHERE 
        follower.follower_user_id = ${user_id}
  `;
  const userFollower = await db.all(userFollowerQuery);
  if (
    userFollower.some((item) => item.following_user_id === tweetResult.user_id)
  ) {
    console.log(tweetResult);
    console.log(userFollower);
    const getTweetQuery = `
      SELECT 
      tweet,
      COUNT(DISTINCT(like.like_id) AS likes,
      COUNT(DISTINCT(reply.reply_id) AS replies
      tweet.date_time AS dateTime
      FROM 
      tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id 
      INNER JOIN reply ON reply.tweet_id = tweet.tweet_id
      WHERE 
        tweet.tweet_id = ${tweetId} AND tweet.user_id = ${userFollower[0].user_id};`;
    const tweetDetails = await db.get(getTweetQuery);
    response.send(tweetDetails);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request;
    const { payload } = request;
    const { user_id, username, gender, name } = payload;

    const userLikedQuery = `
    SELECT 
        *
    FROM 
       follower INNER JOIN tweet ON tweet.user_id = follower.following_user_id INNER JOIN
       like ON like.tweet_id = tweet.tweet_id
     
      WHERE 
      tweet.tweet_id = ${tweetId} AND
        follower.follower_user_id = ${user_id}
  `;
    const liked = await db.all(userLikedQuery);

    if (liked.length !== 0) {
      let likes = [];
      const getNameArray = (likedUser) => {
        for (let item of liked) {
          likes.push(item.username);
        }
      };
      getNameArray(liked);
      response.send({ likes });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request;
    const { payload } = request;
    const { user_id, username, gender, name } = payload;

    const userRepliedQuery = `
    SELECT 
        *
    FROM 
       follower INNER JOIN tweet ON tweet.user_id = follower.following_user_id INNER JOIN
       reply ON reply.tweet_id = tweet.tweet_id
     
      WHERE 
      tweet.tweet_id = ${tweetId} AND
        follower.follower_user_id = ${user_id}
  `;
    const replied = await db.all(userRepliedQuery);

    if (replied.length !== 0) {
      let replies = [];
      const getNameArray = (replied) => {
        for (let item of replied) {
          let obj = {
            name: item.name,
            reply: item.reply,
          };
          replies.push(obj);
        }
      };
      getNameArray(replied);
      response.send({ replies });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { payload } = request;
  const { user_id, username, gender, name } = payload;

  const getTweetQuery = `
      SELECT 
      tweet.tweet AS tweet,
      COUNT(DISTINCT(like.like_id) AS likes,
      COUNT(DISTINCT(reply.reply_id) AS replies,
      tweet.date_time AS dateTime
      FROM 
      user INNER JOIN tweet ON user.user_id = tweet.user_id
      INNER JOIN like ON tweet.tweet_id = like.tweet_id 
      INNER JOIN reply ON reply.tweet_id = tweet.tweet_id
      WHERE 
        user.user_id = ${userId}
        
      GROUP BY 
      tweet.tweet_id;`;
  const tweetDetails = await db.all(getTweetQuery);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request;
  const { tweetId } = request;
  const { payload } = request;
  const { user_id, username, gender, name } = payload;
  const postTweetQuery = `
  INSERT INTO 
     tweet (tweet, user_id)
     VALUES(
         '${tweet}',
         ${user_id}
     )
  ;`;
  await db.run(postTweetQuery);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request;
    const { payload } = request;
    const { user_id, username, gender, name } = payload;
    const deleteQuery = `
    SELECT 
        *
    FROM 
       tweet
      WHERE 
      tweet.user_id = ${user_id} AND
        tweet.tweet_id = ${tweetId};
  `;
    const tweetUser = await db.all(deleteQuery);
    if (tweetUser.length !== 0) {
      `DELETE FROM tweet
     WHERE tweet.user_id = ${user_id} AND tweet.tweet_id = ${tweetId};`;
      await db.run(deleteQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app.js;
