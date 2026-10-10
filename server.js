
const http = require("http");
const fs = require("fs");
const path = require("path");
const pool = require("./database");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");

const PORT = 3000;
const PUBLIC_DIR = path.resolve(__dirname, "public");

const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml"
};

function sendJSON(res, status, data) {
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8"
    });
    res.end(JSON.stringify(data));
}

const sessions = new Map();
const SESSION_DURATION_MS = 30 * 60 * 1000; // 30 minutes

function parseCookies(req) {
    const cookies = {};

    for (const part of (req.headers.cookie || "").split(";")) {
        const separator = part.indexOf("=");

        if (separator === -1) continue;

        const name = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();

        cookies[name] = value;
    }

    return cookies;
}

function getSession(req) {
    const token = parseCookies(req).sid;

    if (!token) return null;

    const session = sessions.get(token);

    if (!session) return null;

    if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return null;
    }

    return session;
}

function createSession(username, adminId) {
    const token = crypto.randomBytes(32).toString("hex");

    sessions.set(token, {
        adminId,
        username,
        expiresAt: Date.now() + SESSION_DURATION_MS
    });

    return token;
}

function setSessionCookie(res, token) {
    res.setHeader(
        "Set-Cookie",
        `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`
    );
}

function clearSessionCookie(res) {
    res.setHeader(
        "Set-Cookie",
        "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
    );
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        let size = 0;

        req.on("data", chunk => {
            size += chunk.length;

            if (size > 1024 * 1024) {
                reject(new Error("Request body too large"));
                req.destroy();
                return;
            }

            body += chunk;
        });

        req.on("end", () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch {
                reject(new Error("Invalid JSON"));
            }
        });

        req.on("error", reject);
    });
}

function validateStudent(data) {
    if (typeof data.name !== "string" || !data.name.trim()) {
        return "Name is required.";
    }

    if (typeof data.email !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
        return "Enter a valid email address.";
    }

    if (data.course != null &&
        typeof data.course !== "string") {
        return "Course must be text.";
    }

    if (data.semester != null &&
        (!Number.isInteger(Number(data.semester)) ||
         Number(data.semester) < 1 ||
         Number(data.semester) > 8)) {
        return "Semester must be between 1 and 8.";
    }

    // Current database column is DECIMAL(3,2), so its maximum is 9.99.
    if (data.cgpa != null &&
        (!Number.isFinite(Number(data.cgpa)) ||
         Number(data.cgpa) < 0 ||
         Number(data.cgpa) > 9.99)) {
        return "CGPA must be between 0 and 9.99.";
    }

    return null;
}

function studentValues(data) {
    return [
        data.name.trim(),
        data.email.trim(),
        data.course?.trim() || null,
        data.semester == null || data.semester === ""
            ? null : Number(data.semester),
        data.cgpa == null || data.cgpa === ""
            ? null : Number(data.cgpa)
    ];
}

async function handleAPI(req, res, url) {

    const pathname = url.pathname;

    // ADMIN LOGIN
    if (pathname === "/api/login" && req.method === "POST") {
        const data = await readBody(req);

        if (
            typeof data.username !== "string" ||
            typeof data.password !== "string" ||
            !data.username.trim() ||
            !data.password ||
            data.username.length > 50 ||
            data.password.length > 128
        ) {
            return sendJSON(res, 400, {
                error: "Enter a valid username and password."
            });
        }

        const username = data.username.trim();

        const [rows] = await pool.execute(
            `SELECT id, username, password_hash
             FROM admin_users
             WHERE username = ?
             LIMIT 1`,
            [username]
        );

        const admin = rows[0];

        const passwordMatches = admin
            ? await bcrypt.compare(data.password, admin.password_hash)
            : false;

        if (!passwordMatches) {
            return sendJSON(res, 401, {
                error: "Invalid username or password."
            });
        }

        const token = createSession(admin.username, admin.id);
        setSessionCookie(res, token);

        return sendJSON(res, 200, {
            message: "Login successful.",
            username: admin.username
        });
    }

    // CHECK LOGIN STATUS
    if (pathname === "/api/auth/status" && req.method === "GET") {
        const session = getSession(req);

        if (!session) {
            return sendJSON(res, 401, {
                authenticated: false
            });
        }

        return sendJSON(res, 200, {
            authenticated: true,
            username: session.username
        });
    }

    // ADMIN LOGOUT
    if (pathname === "/api/logout" && req.method === "POST") {
        const token = parseCookies(req).sid;

        if (token) {
            sessions.delete(token);
        }

        clearSessionCookie(res);

        return sendJSON(res, 200, {
            message: "Logout successful."
        });
    }

    // PROTECT ALL OTHER API ROUTES
    const session = getSession(req);

    if (!session) {
        return sendJSON(res, 401, {
            error: "Authentication required. Please log in."
        });
    }
    if (pathname === "/api/health" && req.method === "GET") {
        const [rows] = await pool.query(
            "SELECT COUNT(*) AS total_students FROM student"
        );

        return sendJSON(res, 200, {
            status: "connected",
            database: "student_management",
            totalStudents: rows[0].total_students
        });
    }

    if (pathname === "/api/students" && req.method === "GET") {
        const search = url.searchParams.get("search") || "";
        const term = `%${search}%`;

        const [rows] = await pool.execute(
            `SELECT id, name, email, course, semester, cgpa
             FROM student
             WHERE name LIKE ? OR email LIKE ? OR CAST(id AS CHAR) LIKE ?
             ORDER BY id DESC`,
            [term, term, term]
        );

        return sendJSON(res, 200, rows);
    }

    if (pathname === "/api/students" && req.method === "POST") {
        const data = await readBody(req);
        const error = validateStudent(data);

        if (error) return sendJSON(res, 400, { error });

        const [result] = await pool.execute(
            `INSERT INTO student
             (name, email, course, semester, cgpa)
             VALUES (?, ?, ?, ?, ?)`,
            studentValues(data)
        );

        return sendJSON(res, 201, {
            message: "Student added successfully.",
            id: result.insertId
        });
    }

    const match = pathname.match(/^\/api\/students\/(\d+)$/);

    if (match) {
        const id = Number(match[1]);

        if (id < 1) {
            return sendJSON(res, 400, { error: "Invalid student ID." });
        }

        if (req.method === "GET") {
            const [rows] = await pool.execute(
                "SELECT * FROM student WHERE id = ?",
                [id]
            );

            if (!rows.length) {
                return sendJSON(res, 404, { error: "Student not found." });
            }

            return sendJSON(res, 200, rows[0]);
        }

        if (req.method === "PUT") {
            const data = await readBody(req);
            const error = validateStudent(data);

            if (error) return sendJSON(res, 400, { error });

            const [result] = await pool.execute(
                `UPDATE student
                 SET name = ?, email = ?, course = ?, semester = ?, cgpa = ?
                 WHERE id = ?`,
                [...studentValues(data), id]
            );

            if (!result.affectedRows) {
                return sendJSON(res, 404, { error: "Student not found." });
            }

            return sendJSON(res, 200, {
                message: "Student updated successfully."
            });
        }

        if (req.method === "DELETE") {
            const [result] = await pool.execute(
                "DELETE FROM student WHERE id = ?",
                [id]
            );

            if (!result.affectedRows) {
                return sendJSON(res, 404, { error: "Student not found." });
            }

            return sendJSON(res, 200, {
                message: "Student deleted successfully."
            });
        }
    }

    return sendJSON(res, 404, { error: "API route not found." });
}

async function handleRequest(req, res) {
    try {
        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

        if (url.pathname.startsWith("/api/")) {
            return await handleAPI(req, res, url);
        }

        if (req.method !== "GET" && req.method !== "HEAD") {
            return sendJSON(res, 405, { error: "Method not allowed." });
        }

        let pathname = decodeURIComponent(url.pathname);

        if (pathname === "/") pathname = "/index.html";

        const filePath = path.resolve(
            PUBLIC_DIR,
            "." + pathname
        );

        if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
            return sendJSON(res, 403, { error: "Forbidden." });
        }

        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(404, {
                    "Content-Type": "text/plain; charset=utf-8"
                });
                return res.end("Page not found. Create public/index.html.");
            }

            res.writeHead(200, {
                "Content-Type":
                    mimeTypes[path.extname(filePath).toLowerCase()] ||
                    "application/octet-stream"
            });

            res.end(req.method === "HEAD" ? undefined : content);
        });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return sendJSON(res, 409, {
                error: "This email address is already registered."
            });
        }

        const status = error.message === "Invalid JSON" ? 400 :
            error.message === "Request body too large" ? 413 : 500;

        if (!res.headersSent) {
            sendJSON(res, status, {
                error: status === 500
                    ? "Server error. Check the server terminal."
                    : error.message
            });
        }
    }
}

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
    console.log(`Student Management Web App running at http://localhost:${PORT}`);
    console.log("Using Node.js built-in HTTP module (no Express.js).");
});