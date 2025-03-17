const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root', // Replace with your MySQL user
    password: '123', // Replace with your MySQL password
    database: 'lineup_sensei', // Replace with your MySQL database name
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Get subjects
app.post('/getSubjects', async (req, res) => {
    const { department, semester, year } = req.body;
    try {
        const [rows] = await pool.query('SELECT id, name FROM subjects WHERE department = ? AND semester = ? AND year = ?', [department, semester, year]);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching subjects:', error);
        res.status(500).json({ message: 'Error fetching subjects.' });
    }
});

// Save assignments
app.post('/saveAssignments', async (req, res) => {
    const assignments = req.body.assignments;
    try {
        for (const assignment of assignments) {
            await pool.query('INSERT INTO staff_subject_assignments (staffId, subjectId, classYear) VALUES (?, ?, ?)', [assignment.staffId, assignment.subjectId, assignment.classYear]);
        }
        res.json({ message: 'Assignments saved.' });
    } catch (error) {
        console.error('Error saving assignments:', error);
        res.status(500).json({ message: 'Error saving assignments.' });
    }
});

// Generate timetable (CSP Algorithm)
app.post('/generateTimetable', async (req, res) => {
    const assignments = req.body.assignments;
    try {
        // 1. Fetch data from database
        const [staffRows] = await pool.query('SELECT * FROM staff');
        const staff = staffRows.reduce((acc, row) => { acc[row.staffId] = row; return acc; }, {});
        const [subjectRows] = await pool.query('SELECT * FROM subjects');
        const subjects = subjectRows.reduce((acc, row) => { acc[row.id] = row; return acc; }, {});
        const [classroomRows] = await pool.query('SELECT * FROM classrooms');
        const classrooms = classroomRows.map(row => row);
        const [labRows] = await pool.query('SELECT * FROM labs');
        const labs = labRows.map(row => row);

        // 2. Prepare time slots and days
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        const timeSlots = [
            '8:10-9:10', '9:10-10:10', '10:30-11:30', '11:30-12:30',
            '1:00-2:00', '2:00-3:00', '3:00-4:00'
        ];

        // 3. Initialize timetable structure
        const timetable = {};
        assignments.forEach(assignment => {
            if (!timetable[assignment.staffId]) {
                timetable[assignment.staffId] = {};
                days.forEach(day => {
                    timetable[assignment.staffId][day] = {};
                    timeSlots.forEach(slot => {
                        timetable[assignment.staffId][day][slot] = null;
                    });
                });
            }
        });

        // 4. CSP Algorithm (Simple Backtracking)
        const isConflict = (staffId, day, slot, subjectId, isPractical = false) => {
            // Check for staff conflicts
            for (const otherStaffId in timetable) {
                if (otherStaffId !== staffId && timetable[otherStaffId][day][slot] && timetable[otherStaffId][day][slot].subjectId === subjectId) {
                    return true;
                }
            }

            // Check for room conflicts (classroom/lab)
            let roomType = isPractical ? 'lab' : 'classroom';
            let assignedRoom = null;

            if (isPractical){
                for (let lab of labs){
                    if (lab.department === subjects[subjectId].department){
                        assignedRoom = lab;
                        break;
                    }
                }
                if (!assignedRoom){
                    return true;
                }
            } else {
                for (let classroom of classrooms){
                    if (classroom.department === subjects[subjectId].department){
                        assignedRoom = classroom;
                        break;
                    }
                }
                if (!assignedRoom){
                    return true;
                }
            }

            for (const otherStaffId in timetable) {
                if (otherStaffId !== staffId && timetable[otherStaffId][day][slot] && timetable[otherStaffId][day][slot].room && timetable[otherStaffId][day][slot].room.roomNumber === assignedRoom.roomNumber) {
                    return true;
                }
            }

            return false;
        };

        const assignSubject = (staffId, day, slot, subjectId, isPractical = false) => {
            let room = null;
            if (isPractical){
                for (let lab of labs){
                    if (lab.department === subjects[subjectId].department){
                        room = lab;
                        break;
                    }
                }
            } else {
                for (let classroom of classrooms){
                    if (classroom.department === subjects[subjectId].department){
                        room = classroom;
                        break;
                    }
                }
            }

            timetable[staffId][day][slot] = {
                subjectId: subjectId,
                room: room,
                isPractical: isPractical
            };
        };

        const solveTimetable = (assignmentIndex = 0) => {
            if (assignmentIndex >= assignments.length) {
                return true; // All assignments scheduled
            }

            const assignment = assignments[assignmentIndex];
            const staffId = assignment.staffId;
            const subjectId = parseInt(assignment.subjectId);

            let lecturesAssigned = 0;
            let practicalsAssigned = 0;

            for (const day of days) {
                for (const slot of timeSlots) {
                    if (timetable[staffId][day][slot] === null) {
                        if (lecturesAssigned < 2 && !isConflict(staffId, day, slot, subjectId)) {
                            assignSubject(staffId, day, slot, subjectId);
                            lecturesAssigned++;
                            if (solveTimetable(assignmentIndex + 1)) {
                                return true;
                            }
                            timetable[staffId][day][slot] = null; // Backtrack
                            lecturesAssigned--;
                        } else if (practicalsAssigned < 1 && !isConflict(staffId, day, slot, subjectId, true)) {
                            assignSubject(staffId, day, slot, subjectId, true);
                            practicalsAssigned++;
                            if (solveTimetable(assignmentIndex + 1)) {
                                return true;
                            }
                            timetable[staffId][day][slot] = null; // Backtrack
                            practicalsAssigned--;
                        }
                    }
                }
            }
            return false; // No valid assignment found
        };

        if (solveTimetable()) {
            // 5. Store timetable in database
            for (const staffId in timetable) {
                const schedule = JSON.stringify(timetable[staffId]);
                const staffDepart = staff[staffId].department;
                const staffSem = subjects[assignments[0].subjectId].semester;
                await pool.query('INSERT INTO timetables (department, semester, schedule) VALUES (?, ?, ?)', [staffDepart, staffSem, schedule]);
            }
            res.json({ message: 'Timetable generated and saved.' });
        } else {
            res.status(500).json({ message: 'Could not generate timetable.' });
        }
    } catch (error) {
        console.error('Error generating timetable:', error);
        res.status(500).json({ message: 'Error generating timetable.' });
    }
});

// Upload Excel File
app.post('/uploadExcel', upload.single('excelFile'), async (req, res) => {
    try { 
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);

    for (const row of data) {
        await pool.query('INSERT INTO uploaded_excel_data (staffId, staffName, department, subjectName, classYear, semester) VALUES (?, ?, ?, ?, ?, ?)', [row.staffId, row.staffName, row.department, row.subjectName, row.classYear, row.semester]);
    }
    res.json({ message: 'Excel file uploaded.' });
} catch (error) {
    console.error('Error uploading Excel file:', error);
    res.status(500).json({ message: 'Error uploading Excel file.' });
}
});

//Validate Staff
app.post('/validateStaff', async(req, res)=>{
const {staffId, staffName} = req.body;
try {
    const [rows] = await pool.query('SELECT * FROM staff WHERE staffId = ? AND name = ?', [staffId, staffName]);
    if (rows.length > 0){
        res.json({valid: true});
    } else {
        res.json({valid: false});
    }
} catch (error){
    console.error("error validating staff", error);
    res.status(500).json({message: "Error validating staff"});
}

})

app.listen(port, () => console.log(`Server running on port ${port}`));