const API_URL = "/api/students";

const tableBody = document.getElementById("studentTableBody");
const searchInput = document.getElementById("searchInput");
const studentDialog = document.getElementById("studentDialog");
const studentForm = document.getElementById("studentForm");
const messageBox = document.getElementById("message");

let searchTimer;
let messageTimer;
let redirectingToLogin = false;

// Display today's date
document.getElementById("todayDate").textContent =
    new Date().toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric"
    });

// Safely display text in HTML
function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

// Common API request function
async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        credentials: "same-origin",
        headers: {
            ...(options.body
                ? { "Content-Type": "application/json" }
                : {}),
            ...options.headers
        }
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 401 && !redirectingToLogin) {
        redirectingToLogin = true;
        window.location.replace("/login.html");
        throw new Error("Your session has expired. Please log in again.");
    }

    if (!response.ok) {
        throw new Error(data.error || "Request failed.");
    }

    return data;
}

// Display success and error messages
function showMessage(text, isError = false) {
    clearTimeout(messageTimer);

    messageBox.textContent = text;
    messageBox.classList.remove("hidden", "error");

    if (isError) {
        messageBox.classList.add("error");
    }

    messageTimer = setTimeout(() => {
        messageBox.classList.add("hidden");
    }, 4000);
}

// Check database connection
async function checkConnection() {
    const status = document.getElementById("connectionStatus");
    const dot = document.querySelector(".status-dot");

    try {
        const data = await apiRequest("/api/health");

        status.textContent = "Database connected";
        dot.classList.add("connected");

        document.getElementById("totalStudents").textContent =
            data.totalStudents;
    } catch (error) {
        status.textContent = "Database unavailable";
        dot.classList.remove("connected");
        throw error;
    }
}

// Update dashboard statistics
function updateStatistics(students) {
    document.getElementById("totalStudents").textContent =
        students.length;

    const courses = new Set(
        students.map(student => student.course).filter(Boolean)
    );

    const semesters = new Set(
        students
            .map(student => student.semester)
            .filter(value => value != null)
    );

    const cgpas = students
        .filter(student =>
            student.cgpa != null && student.cgpa !== ""
        )
        .map(student => Number(student.cgpa))
        .filter(Number.isFinite);

    document.getElementById("totalCourses").textContent =
        courses.size;

    document.getElementById("totalSemesters").textContent =
        semesters.size;

    const average = cgpas.length
        ? cgpas.reduce((sum, value) => sum + value, 0) / cgpas.length
        : null;

    document.getElementById("averageCGPA").textContent =
        average === null ? "—" : average.toFixed(2);
}

// Display student records in the table
function renderStudents(students) {
    updateStatistics(students);

    document.getElementById("tableCount").textContent =
        `${students.length} student${students.length === 1 ? "" : "s"} found`;

    if (!students.length) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="loading-cell">
                    No student records found.
                </td>
            </tr>`;
        return;
    }

    tableBody.innerHTML = students.map(student => `
        <tr>
            <td>
                <span class="id-badge">
                    #${escapeHTML(student.id)}
                </span>
            </td>
            <td>
                <div class="student-name">
                    ${escapeHTML(student.name)}
                </div>
                <div class="student-email">
                    ${escapeHTML(student.email)}
                </div>
            </td>
            <td>
                <span class="course-badge">
                    ${escapeHTML(student.course || "Not specified")}
                </span>
            </td>
            <td>
                ${student.semester == null
                    ? "—"
                    : escapeHTML(student.semester)}
            </td>
            <td>
                ${student.cgpa == null
                    ? "—"
                    : escapeHTML(Number(student.cgpa).toFixed(2))}
            </td>
            <td>
                <div class="action-buttons">
                    <button
                        class="icon-btn"
                        data-action="edit"
                        data-id="${Number(student.id)}"
                        title="Edit student">
                        Edit
                    </button>
                    <button
                        class="icon-btn delete"
                        data-action="delete"
                        data-id="${Number(student.id)}"
                        title="Delete student">
                        Delete
                    </button>
                </div>
            </td>
        </tr>
    `).join("");
}

// Load student records
async function loadStudents(search = "") {
    tableBody.innerHTML = `
        <tr>
            <td colspan="6" class="loading-cell">
                Loading student records...
            </td>
        </tr>`;

    try {
        const url = `${API_URL}?search=${encodeURIComponent(search)}`;
        const students = await apiRequest(url);

        renderStudents(students);
        await checkConnection();
    } catch (error) {
        if (redirectingToLogin) return;

        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="loading-cell">
                    Could not load records.
                    Check that the server and database are running.
                </td>
            </tr>`;

        showMessage(error.message, true);
    }
}

// Open the Add Student form
function openAddDialog() {
    studentForm.reset();

    document.getElementById("studentId").value = "";
    document.getElementById("dialogTitle").textContent =
        "Add New Student";
    document.getElementById("saveStudentBtn").textContent =
        "Save Student";

    studentDialog.showModal();
}

// Open the Edit Student form
async function openEditDialog(id) {
    try {
        const student = await apiRequest(`${API_URL}/${id}`);

        document.getElementById("studentId").value = student.id;
        document.getElementById("name").value = student.name || "";
        document.getElementById("email").value = student.email || "";
        document.getElementById("course").value = student.course || "";

        document.getElementById("semester").value =
            student.semester == null ? "" : student.semester;

        document.getElementById("cgpa").value =
            student.cgpa == null ? "" : student.cgpa;

        document.getElementById("dialogTitle").textContent =
            "Edit Student";
        document.getElementById("saveStudentBtn").textContent =
            "Update Student";

        studentDialog.showModal();
    } catch (error) {
        showMessage(error.message, true);
    }
}

// Add Student buttons
document.getElementById("openAddForm")
    .addEventListener("click", openAddDialog);

document.getElementById("sectionAddBtn")
    .addEventListener("click", openAddDialog);

document.getElementById("addStudentLink")
    .addEventListener("click", event => {
        event.preventDefault();
        openAddDialog();
    });

// Close and cancel dialog buttons
document.getElementById("closeDialog")
    .addEventListener("click", () => studentDialog.close());

document.getElementById("cancelDialog")
    .addEventListener("click", () => studentDialog.close());

// Dashboard navigation
document.getElementById("dashboardLink")
    .addEventListener("click", event => {
        event.preventDefault();
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

document.getElementById("studentsLink")
    .addEventListener("click", () => {
        document.getElementById("studentsSection").scrollIntoView({
            behavior: "smooth"
        });
    });

// Refresh student records
document.getElementById("refreshBtn")
    .addEventListener("click", () => {
        loadStudents(searchInput.value.trim());
    });

// Search students
searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);

    searchTimer = setTimeout(() => {
        loadStudents(searchInput.value.trim());
    }, 250);
});

// Add or update a student
studentForm.addEventListener("submit", async event => {
    event.preventDefault();

    const id = document.getElementById("studentId").value;
    const semesterValue = document.getElementById("semester").value;
    const cgpaValue = document.getElementById("cgpa").value;

    const student = {
        name: document.getElementById("name").value.trim(),
        email: document.getElementById("email").value.trim(),
        course: document.getElementById("course").value.trim(),
        semester: semesterValue === "" ? null : Number(semesterValue),
        cgpa: cgpaValue === "" ? null : Number(cgpaValue)
    };

    const saveButton = document.getElementById("saveStudentBtn");
    saveButton.disabled = true;
    saveButton.textContent = "Saving...";

    try {
        const result = await apiRequest(
            id ? `${API_URL}/${id}` : API_URL,
            {
                method: id ? "PUT" : "POST",
                body: JSON.stringify(student)
            }
        );

        studentDialog.close();
        showMessage(result.message || "Student saved successfully.");

        searchInput.value = "";
        await loadStudents();
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = id ? "Update Student" : "Save Student";
    }
});

// Edit and delete actions in the table
tableBody.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");

    if (!button) return;

    const id = button.dataset.id;
    const action = button.dataset.action;

    if (action === "edit") {
        await openEditDialog(id);
    }

    if (action === "delete") {
        const confirmed = confirm(
            `Are you sure you want to delete student ID ${id}?`
        );

        if (!confirmed) return;

        try {
            const result = await apiRequest(`${API_URL}/${id}`, {
                method: "DELETE"
            });

            showMessage(
                result.message || "Student deleted successfully."
            );

            await loadStudents(searchInput.value.trim());
        } catch (error) {
            showMessage(error.message, true);
        }
    }
});

// Check authentication before loading the dashboard
async function initializeDashboard() {
    try {
        const response = await fetch("/api/auth/status", {
            credentials: "same-origin"
        });

        if (!response.ok) {
            window.location.replace("/login.html");
            return;
        }

        const auth = await response.json();

        const usernameElement =
            document.getElementById("adminUsername") ||
            document.querySelector(".sidebar-bottom strong");

        if (usernameElement && auth.username) {
            usernameElement.textContent = auth.username;
        }

        await loadStudents();
    } catch (error) {
        document.getElementById("connectionStatus").textContent =
            "Server unavailable";

        showMessage(
            "Could not verify your login. Make sure the server is running.",
            true
        );
    }
}

// Logout
const logoutButton = document.getElementById("logoutBtn");

if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
        logoutButton.disabled = true;
        logoutButton.textContent = "Logging out...";

        try {
            await fetch("/api/logout", {
                method: "POST",
                credentials: "same-origin"
            });
        } finally {
            window.location.replace("/login.html");
        }
    });
}

// Start the dashboard only after authentication is checked
initializeDashboard();