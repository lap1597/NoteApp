import express from "express";
import nodemailer from "nodemailer";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { OAuth2Client } from "google-auth-library";
import { google } from 'googleapis';
import session from 'express-session';  // Import express-session
import mysql from "mysql2/promise";

import OpenAI from 'openai';

dotenv.config();
const app = express();
const port = 3000;

// Configure session middleware
app.use(session({
    secret: process.env.SECRET_KEY,  // Change this to a secure key
    resave: false,
    saveUninitialized: true,
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set('view engine', 'ejs');
app.use(express.static("public"));

let myData;
// Create connection pool
myData = mysql.createPool({
    host: process.env.DB_HOST,       // Your database host
    user: process.env.SQL_USERNAME, // Your database username
    password: process.env.SQL_PASS, // Your database password
    database: process.env.SQL_NAME, // Your database name
    multipleStatements: true

});


const openai = new OpenAI({
    apiKey: process.env.OPEN_AI_API // This is also the default, can be omitted
  });

// Google OAuth setup
const googleClientId = process.env.CLIENT_ID;
const googleClientSecret = process.env.CLIENT_SRC;
const googleClient = new OAuth2Client(googleClientId);

// Redirect URI for OAuth
const redirectUri = "http://localhost:3000/auth/google/callback";

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    } else {
        res.redirect("/"); // Redirect to login page if not authenticated
    }
};

const CATEGORY_COLORS = {
    'class': '1',   // Light blue
    'study': '2',   // Light green
    'meeting': '3', // Purple
    'project': '4', // Red
    'break': '5',   // Yellow
    'personal': '6' // Orange
};


app.get("/", (req, res) => {
    res.render("index.ejs", { isAuthenticated: !!req.session.user });
});

app.get("/about", (req, res) => {
    res.render("about.ejs", { isAuthenticated: !!req.session.user });
});

app.get("/contact", (req, res) => {
    res.render("contact.ejs", { isAuthenticated: !!req.session.user });
});
app.get("/note", isAuthenticated, (req, res) => {

    //check connection
    myData.getConnection((err, connection) => {
        if (err) {
            console.error("Error connecting to the database:", err);
            return;
        }
        console.log("Database connected successfully.");
        connection.query("SELECT * FROM users", (queryErr, results) => {
            if (queryErr) {
                console.error("Error executing query:", queryErr);
            } else {
                console.log("Query Results:", results);
            }
        });
        connection.release();
    });
    res.render("note.ejs", { isAuthenticated: !!req.session.user });
});


app.get("/quit", (req, res) => {
    req.session.destroy();
    
    res.redirect("/");
});


app.get("/auth/google", (req, res) => {
    const scopes = [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/calendar',
        // 'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/gmail.send'
    ];
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${googleClientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scopes.join(' ')}&access_type=offline`;
    res.redirect(authUrl);
});

// Google OAuth callback handler
app.get("/auth/google/callback", async (req, res) => {
    const code = req.query.code;

    try {
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                code: code,
                client_id: googleClientId,
                client_secret: googleClientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
            })
        });
        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        if (!accessToken) {
            throw new Error("Failed to retrieve access token.");
        }

        // Store tokenData in the session
        req.session.tokenData = tokenData;

        const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
   

        const userInfo = await userInfoResponse.json();
        if (userInfo.email_verified) {

            req.session.user = userInfo; 
            myData = mysql.createPool({
                host: process.env.DB_HOST,       // Your database host
                user: process.env.SQL_USERNAME, // Your database username
                password: process.env.SQL_PASS, // Your database password
                database: process.env.SQL_NAME, // Your database name
                multipleStatements: true
            });
      
            const insertUserQuery = `
                INSERT INTO users (email, name)
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE name = VALUES(name);
            `;
         
            // Insert the user into the database
         //   console.log("Running Query:", insertUserQuery, [req.session.user.email, req.session.user.name]);
            myData.query(insertUserQuery, [req.session.user.email, req.session.user.name], (err, result) => {
                if (err) {
                    console.error("Error inserting user into the database:", err);
                    res.status(500).send("Internal Server Error");
                    return;
                }
                // console.log("ERROR?");
                console.log("Result:", result);
        
                if (result.affectedRows === 1) {
                    console.log("New user inserted.");
                } else if (result.affectedRows === 2) {
                    console.log("Existing user updated.");
                } else {
                    console.log("No rows affected (possible duplicate with same data).");
                }
            
            });
            

            
            res.redirect("/note");
        } else {
            res.status(401).send("Email not verified");
        }
    } catch (error) {
        console.error("Error during Google OAuth:", error);
        res.redirect("/");
    }
});

// Send email route
app.post("/send-email", async (req, res) => {
    const { name, message } = req.body;

    let transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.CUSTOME_EMAIL,
            pass: process.env.APP_PASS
        }
    });

    let mailOptions = {
        from: process.env.CUSTOME_EMAIL,
        to: process.env.RECEIVER_EMAIL,
        subject: `New message from ${name}`,
        text: message
    };

    try {
        await transporter.sendMail(mailOptions);
        return res.redirect("/contact");
     //   res.send("Email has been sent successfully!");
        res.redirect()
    } catch (error) {
        if (!res.headersSent) {
            return res.status(500).send("There was an error sending the email. Please try again later.");
        }
        console.error("Error sending email:", error);
        res.status(500).send("There was an error sending the email. Please try again later.");
    }
});

// Create event route
app.post("/create_event", isAuthenticated, async (req, res) => {
   
    let { publishToCalendar, description, summary, start, end, startTime, endTime, category ,useAiSuggestion} = req.body;

    if (publishToCalendar == "true" ) {
      

        const accessToken = req.session.tokenData.access_token;
        const oAuth2Client = new google.auth.OAuth2();
        oAuth2Client.setCredentials({ access_token: accessToken });

        const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    
        if (useAiSuggestion == "true") {
            const startT = new Date(`${start}T00:00:00Z`).toISOString(); // Z ensures UTC
            const endT = new Date(`${end}T23:59:59Z`).toISOString(); // Adjust to include entire end day
            
                const eventsResult = await calendar.events.list({
                    calendarId: 'primary',
                    timeMin: startT,
                    timeMax: endT,
                    singleEvents: true,
                    orderBy: 'startTime',
                    timeZone: 'America/Los_Angeles',
                });
           console.log("RESULT"+eventsResult);
            const events = eventsResult.data.items || [];

            const openaiResponse = await generateChatResponse(events, summary, category, description, start, end);

            console.log(`AI response: ${openaiResponse}`);
            const suggestedTime = parseSuggestedTime(openaiResponse);
            const suggestedStartTime = suggestedTime.startTime;
            const suggestedEndTime = suggestedTime.endTime;

        
            // Use suggested time or fallback to user input
            startTime = suggestedStartTime || startTime;
            endTime = suggestedEndTime || endTime;
        }
        console.log(startTime);
        console.log(endTime);
        // Create event object
        const event = {
            summary,
            description,
            start: {
      
              dateTime: formatDateTime(start, startTime),
                timeZone: 'America/Los_Angeles', 
            },
            end: {
             
               dateTime: formatDateTime(end, endTime), 
                timeZone: 'America/Los_Angeles',
            },
            colorId: CATEGORY_COLORS[category] || 'default',
            timeZone: 'America/Los_Angeles',
           
        };

        try {
            
            const eventResponse = await calendar.events.insert({
                calendarId: 'primary',
                resource: event,
                colorID: category
               // timeZone:  'America/Los_Angeles'
            });
            console.log("Event created:", eventResponse.data);
          
            if (eventResponse.status === 200 || eventResponse.status === 201) {
            
                res.redirect("/note");
            } else {
                console.error("Failed to create event:", eventResponse);
                res.status(500).send("Error creating calendar event.");
            }
        } catch (error) {
            console.error("Error creating calendar event:", error);
            res.status(500).send("Error creating calendar event.");
        }
    } else {
       // let description =req.body;

        try {
        

            const summary = null;
            const query = `
            INSERT INTO notes (user_email, summary, descriptions)
            VALUES (?, ?, ?);
        `;
    
        const userEmail = req.session.user.email;
        const parameters = [
            userEmail,
            summary || "Quick note", // Default summary if not provided
            description || "",       // Default empty description if not provided
        ];
    
        // Execute the query and log the raw result
        const result = await myData.execute(query, parameters);

            console.log("Regular note saved:", result);
            res.redirect("/note");
        } catch (error) {
            console.error("Error saving note:", error.message);
            res.status(500).send("Error saving note.");
        }
    
    }
});


// Fetch completed notes route
app.get("/completed_notes", isAuthenticated, async (req, res) => {
 //   const identifier = "CreatedFromWebpage"; // The identifier to filter events
    try {
        const accessToken = req.session.tokenData.access_token;
        const oAuth2Client = new google.auth.OAuth2();
        oAuth2Client.setCredentials({ access_token: accessToken });

        const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
        const now = new Date().toISOString();
        const oneWeekFromNow = new Date(); // Create a new date object
        oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 30); // Add 7 days
        const timeMax =  oneWeekFromNow.toISOString();
        
    
        const userEmail = req.session.user.email;
        const [rows] = await myData.query("SELECT id, summary, descriptions FROM notes WHERE user_email = ? ",[userEmail]);


        const eventsResult = await calendar.events.list({
            calendarId: 'primary',
            timeMin: now,
            timeMax: timeMax,
            singleEvents: true,
            orderBy: 'startTime',
            timeZone:  'America/Los_Angeles'
        });
      
        if (eventsResult.data && eventsResult.data.items) {

            const events = eventsResult.data.items; // Extract events from the response
        
          
            // Render the completed notes page with events
            res.render("complete_note.ejs", {
                isAuthenticated: !!req.session.user,
                notes: rows,
                events: events,
            });

        } else {
            console.error("No items found in eventsResult:", eventsResult);
            res.status(404).send("No events found.");
        }
    } catch (error) {
        console.error("Error fetching events:", error);
        res.status(500).send("Error fetching events.");
    }
});
// const formatDateTime = (date, time) => {
//     const dt = new Date(`${date}T${time}`);
//     return dt.toISOString().slice(0, 19); // Format as YYYY-MM-DDTHH:mm:ss
// };
const formatDateTime = (date, time) => {
    const dt = new Date(`${date}T${time}`);
    const options = {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23', // 24-hour format
    };

    // Format in Los Angeles time zone
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(dt);

    // Assemble formatted date-time as "YYYY-MM-DDTHH:mm:ss"
    const formattedDateTime = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}T${parts.find(p => p.type === 'hour').value}:${parts.find(p => p.type === 'minute').value}:${parts.find(p => p.type === 'second').value}`;

    return formattedDateTime;
};

app.delete('/delete_event/:id', async (req, res) => {
    const eventId = req.params.id;
    const accessToken = req.session.tokenData.access_token;

    try {
        // Initialize OAuth2 client
        const oAuth2Client = new google.auth.OAuth2();
        oAuth2Client.setCredentials({ access_token: accessToken });

        // Create calendar client
        const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

        // Delete event from Google Calendar
        await calendar.events.delete({
            calendarId: 'primary',
            eventId: eventId,
        });

        res.status(200).send('Event deleted successfully');
    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).send('Failed to delete the event');
    }
});

app.delete('/delete_note/:id', isAuthenticated, async (req, res) => {
    try {
        const noteId = req.params.id;
        const query = "DELETE FROM notes WHERE id = ?";

        const [result] = await myData.query(query, [noteId]);

        if (result.affectedRows > 0) {
            res.status(200).send("Note deleted successfully");
        } else {
            res.status(404).send("Note not found");
        }
    } catch (error) {
        console.error("Error deleting note:", error);
        res.status(500).send("Failed to delete note");
    }
});

async function generateChatResponse(events, summary,description, category, startDate, endDate) {
   

// Initialize OpenAI API with the API key from the environment variable

    // Prepare event summaries
    const eventsSummary = events
        .map(event => `${event.start.dateTime} to ${event.end.dateTime}: ${event.summary}`)
        .join("\n");

    // Create the prompt
  //  console.log(eventsSummary);
    const promptT = `
    You are an intelligent assistant. Here are the existing events in the user's calendar:
    ${eventsSummary}
    The user wants to add a new event with the following details:
    Summary: ${summary}
    Description: ${description}
    Category: ${category}
    Date: ${startDate} to ${endDate}

    The event should be scheduled during regular hours (8 AM to 10 PM) and should be realistic for a task like '${summary}', which usually takes about 1 hours.
    Please suggest the optimal start and end time for this new event based on the user's current schedule, description and the category of the event. Important, no overlapping.
    If the time from 8 AM to 10PM if full then you can suggest a time that you think it is fit.
    Return the format in the format: 'Start Time: 00:00', and then a new line with 'End Time: 00:00', with the zeroes seen in the example acting as placeholders.
    I only want the output specified to be printed, and nothing else.
    `;

   

    try {
 
        const response =  await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { "role": "system", "content": "You are an intelligent assistant." },
                { "role": "user", "content": promptT },
            ],
     
        });
       
    //    console.log(response);
      //  console.log("OpenAI response:", response.data);
       console.log("OpenAI response:",  response.choices[0].message);
       // console.log("OpenAI response:",  response.data.choices[0].message.content);
       return response.choices[0].message.content;
    } catch (error) {
        console.error("Error calling OpenAI API:", error.message);
        return "Start Time: 00:00\nEnd Time: 23:59"; // Default fallback times
    }
}


function parseSuggestedTime(aiResponse) {
    try {
        const lines = aiResponse.split('\n');
        
        // Find lines containing "Start Time" and "End Time"
        const startTimeLine = lines.find(line => line.includes("Start Time"));
        const endTimeLine = lines.find(line => line.includes("End Time"));

        if (!startTimeLine || !endTimeLine) {
            throw new Error("Missing start or end time in response");
        }

        //strings to HH:mm:ss format
        const normalizeTime = (timeStr) => {
            const [hours, minutes] = timeStr.split(":");
            const normalized = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:00`;
            return normalized;
        };

        const startTimeStr = normalizeTime(startTimeLine.split(": ")[1]?.trim());
        const endTimeStr = normalizeTime(endTimeLine.split(": ")[1]?.trim());

        if (!startTimeStr || !endTimeStr) {
            throw new Error("Invalid time format");
        }

        // Convert to ISO time format with local timezone adjustment if needed
        const startTime = new Date(`1970-01-01T${startTimeStr}Z`).toISOString().slice(11, 19);
        const endTime = new Date(`1970-01-01T${endTimeStr}Z`).toISOString().slice(11, 19);

        return { startTime, endTime };
    } catch (error) {
        console.error("Error parsing suggested time:", error);
        return { startTime: '00:00:00', endTime: '23:59:59' }; // Fallback times
    }
}



// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
