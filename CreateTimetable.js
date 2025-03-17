$(document).ready(function() {
    let assignments = [];

    // Populate subjects based on department, sem, and class
    $('#department-dropdown, #sem-dropdown, .class-dropdown').change(function() {
        populateSubjects();
    });

    function populateSubjects() {
        const department = $('#department-dropdown').val();
        const semester = $('#sem-dropdown').val();
        const classYear = $('.class-dropdown').val();
        if (department && semester && classYear) {
            $.ajax({
                url: '/getSubjects',
                method: 'POST',
                data: { department: department, semester: semester, year: classYear },
                success: function(subjects) {
                    let subjectDropdown = $('.subject-dropdown');
                    subjectDropdown.empty().append('<option value="">--Select Subject--</option>');
                    subjects.forEach(subject => {
                        subjectDropdown.append(`<option value="${subject.id}">${subject.name}</option>`);
                    });
                }
            });
        }
    }

    // Add subject assignment
    $('#add').click(function() {
        const staffId = $('.staff-id').val();
        const staffName = $('.staff-name').val();
        const classYear = $('.class-dropdown').val();
        const subjectId = $('.subject-dropdown').val();
        const subjectName = $('.subject-dropdown option:selected').text();

        assignments.push({ staffId, staffName, classYear, subjectId, subjectName });
        updateAssignmentsTable();
    });

    function updateAssignmentsTable() {
        let tableBody = $('#assignments tbody');
        tableBody.empty();
        assignments.forEach((assignment, index) => {
            tableBody.append(`
                <tr>
                    <td>${assignment.staffId}</td>
                    <td>${assignment.staffName}</td>
                    <td>${assignment.classYear}</td>
                    <td>${assignment.subjectName}</td>
                    <td><button class="delete-assignment" data-index="${index}">Delete</button></td>
                </tr>
            `);
        });
    }

    // Delete assignment
    $(document).on('click', '.delete-assignment', function() {
        const index = $(this).data('index');
        assignments.splice(index, 1);
        updateAssignmentsTable();
    });

    // Submit form
    $('#submit').click(function(e) {
        e.preventDefault();
        $.ajax({
            url: '/saveAssignments',
            method: 'POST',
            data: { assignments: assignments },
            success: function(response) {
                alert(response.message);
            }
        });
    });

    // Generate timetable
    $('#generateTimetable').click(function() {
        $.ajax({
            url: '/generateTimetable',
            method: 'POST',
            data: { assignments: assignments },
            success: function(response) {
                alert(response.message);
            }
        });
    });

    $('#fileInput').change(function(event) {
        const file = event.target.files[0];
        const formData = new FormData();
        formData.append('excelFile', file);
        $.ajax({
            url: '/uploadExcel',
            type: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            success: function(response) {
                alert(response.message);
            },
            error: function(error) {
                console.error('Error uploading file:', error);
                alert('Error uploading file.');
            }
        });
    });
});