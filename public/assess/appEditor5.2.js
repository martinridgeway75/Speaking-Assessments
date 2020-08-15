/*(c) 2019 Martin Ridgeway <martin@ridgeway.io> MIT license*/
/*A very special thanks to Anna Otterstad and Lee Gaskell - who generously gave their time to help test and develop the app*/
/*global window*/
/*global document*/
/*global pdfMake*/
/*global firebase*/
/*global JSZip*/

window.addEventListener('load', function() {
    (function(){
     "use strict";

//CONFIG
//DATABASE
//UTILS
//RUBRICS
//RECORDS
//SNIPPETS
//STUDENTS
//UI
//PDF
//HANDLERS
//DOM PUNCHING

//CONFIG
var appEditor = {
    editorIsOpen: {
        record: false, rubric: false, grader: false
    },
    db: {
        records: false, rubrics: false, students: false, snippets: false
    },
    appEditRecords: {
        tempStudent: { stId: "", stNme: "", stCls: "" },
        labelIndex: 0,
        tempStudentRecords: [],
        loadedRubric: []
    },
    recordsIndex: [],
    studentData: [],
    table_Id: "",
    table_lookup: {},
    tableObj: {},
    rubricsIndex: {},
    sharedRubricsIndex: {},
    snippets: [],
    grader: {
        noRubricCommentsOnly: false,
        loadedRubric: [],
        snippets: [],
        rubric: [], //the slim rubric
        tempRecord: {
            rubricRef: "",
            context: "Assignment",
            activeSections: []
        }
    }
};

function docEl(id) {
    return document.getElementById(id); // || null
}

//DATABASE
function signOutOfApp() {
    firebase.auth().signOut(); //thus prompting the authState observer...
}

function proceedWithRubricSaveAsNew(rubricName, uid, bool) {
    var postData = convertToRubricObj(rubricName);
    var newPostKey = firebase.database().ref().child('assessments/' + uid + '/savedRubricsIndex/').push().key;
    var idxObj = idxObjFromRubricPostData(postData);
    var updates = {};
    var newShareKey;

    updates['assessments/' + uid + '/savedRubricsIndex/' + newPostKey] = idxObj;
    updates['assessments/' + uid + '/savedRubrics/' + newPostKey] = postData;
    if (bool === true) {
        newShareKey = firebase.database().ref().child('sharedRubrics/rubricsIndex/').push().key;
        updates['sharedRubrics/rubricsIndex/' + newShareKey] = idxObj;
        updates['sharedRubrics/rubrics/' + newShareKey] = postData;
    }
    firebase.database().ref().update(updates, function(e) {
        if (e) {
            chkPermission(e);
            displayMsg("d", e);
            enableEl("editRubric");
        } else {
            rubricCommitted(newPostKey, idxObj, newShareKey);
        }
    });
}

//TODO
function rubricSaveAsNew(rubricName, uid) { //#2. Rubric is new and needs to be created || Rubric exists, BUT is being created as a copy of itself WITH A NEW NAME
    if (docEl("shareThisRubric").checked !== true) {
        proceedWithRubricSaveAsNew(rubricName, uid, false);
        return;
    }
    window.mscConfirm({
        title: '',
        subtitle: 'You have opted to share this rubric with all users. Is that correct?',
        cancelText: 'Cancel',
        onOk: function () {
            proceedWithRubricSaveAsNew(rubricName, uid, true);
        },
        onCancel: function () {
            return;
        }
    });
}

function proceedWithRubricUpdateExisting(rubricName, key, uid, bool) { //#1. Rubric exists and needs to be updated
    var postData = convertToRubricObj(rubricName);
    var idxObj = idxObjFromRubricPostData(postData);
    var updates = {};
    var newShareKey;

    updates['assessments/' + uid + '/savedRubricsIndex/' + key] = idxObj;
    updates['assessments/' + uid + '/savedRubrics/' + key] = postData;
    if (bool === true) {
        newShareKey = firebase.database().ref().child('sharedRubrics/rubricsIndex/').push().key;
        updates['sharedRubrics/rubricsIndex/' + newShareKey] = idxObj;
        updates['sharedRubrics/rubrics/' + newShareKey] = postData;
    }
    firebase.database().ref().update(updates, function(e) {
        if (e) {
            chkPermission(e);
            displayMsg("d", e);
            enableEl("editRubric");
        } else {
            rubricCommitted(key, idxObj, newShareKey);
        }
    });
}

//TODO
function rubricUpdateExisting(rubricName, key, uid) { //#2. Rubric is new and needs to be created || Rubric exists, BUT is being created as a copy of itself WITH A NEW NAME
    if (docEl("shareThisRubric").checked !== true) {
        proceedWithRubricUpdateExisting(rubricName, key, uid, false);
        return;
    }
    window.mscConfirm({
        title: '',
        subtitle: 'You have opted to share this rubric with all users. Is that correct?',
        cancelText: 'Cancel',
        onOk: function () {
            proceedWithRubricUpdateExisting(rubricName, key, uid, true);
        },
        onCancel: function () {
            return;
        }
    });
}

function removeRubrikFromDb(key) {
    var uid = firebase.auth().currentUser.uid;
    var updates = {};

    updates['assessments/' + uid + '/savedRubricsIndex/' + key] = null;
    updates['assessments/' + uid + '/savedRubrics/' + key] = null;

    firebase.database().ref().update(updates, function(e) {
        if (e) {
            chkPermission(e);
        } else {
            rubrikDestroyed(key);
        }
    });
}

function saveSnippetData() {
    var uid = firebase.auth().currentUser.uid;

    firebase.database().ref('assessments/' + uid + '/snippets').set(appEditor.snippets, function(e) { //set() overrides all childs at the ref...
        if (e) {
            chkPermission(e);
            displayMsg("a", e);
            return;
        }
        exitSnippets();
        displayMsg("b");
  });
}

function deleteRecordsViaMap(checkedRecords) { //@server...records for a specific class are being updated with null
    var updates = {};
    var uid = firebase.auth().currentUser.uid;

    checkedRecords.forEach( function (el) {
        // using "null" as the update, effectively deleting it from the db
        //note: if there are no records, then the student is also deleted (because: null)
        //ibid: if there are no students, the class wont exist (because: null)
        updates['assessments/' + uid + '/recordsIndex/' + el] = null;
        updates['assessments/' + uid + '/records/' + el] = null;
    });
    firebase.database().ref().update(updates, function(e) {
        if (e) {
            chkPermission(e);
            displayMsg("n", e);
            return;
        }
        updateDeletionOfRecordsInAppEditor(checkedRecords);
        displayMsg("o");
        buildRecordsMap(); //changes will be reflected onreload here
    });
}

function fetchSingleRecordForDownload(recordKey, elId) {
    var uid = firebase.auth().currentUser.uid;
    var recordObj;

    firebase.database().ref('assessments/' + uid + '/records/' + recordKey).once('value').then(function(snapshot) {
        recordObj = snapshot.val();

        if (recordObj !== null) {
            recordObj.recordKey = recordKey; //add recordKey here so we can update changes by key directly
            dlSingleRecord(recordObj, elId);
        }
    }, function (e){
        chkPermission(e);
    });
}

function fetchSelectedRecordsForDownload(checkedRecords, elId) { //promises!
    var uid = firebase.auth().currentUser.uid;
    var pdfObjArr = [];
    var len = checkedRecords.length;
    var pdfObj,
        recordObj;

    checkedRecords.forEach( function(recordKey) {
        firebase.database().ref('assessments/' + uid + '/records/' + recordKey).once('value').then(function(snapshot) {
            recordObj = snapshot.val();

            if (recordObj !== null) {
                recordObj.recordKey = recordKey; //add recordKey here so we can update changes by key directly
                pdfObj = {};
                pdfObj.content = buildPDFrecord(recordObj);
                pdfObj.name = '' + recordObj.studentData.stCls + '_' + recordObj.studentData.stNme + '_' + recordObj.studentData.stId + '_' + recordObj.context+ '_' + recordObj.timeStamp + '.pdf';
                pdfObjArr.push(pdfObj);

                if (pdfObjArr.length === len) { addToZip(pdfObjArr, elId); }
            }
        }, function (e){
            chkPermission(e);
        });
    });
}

function saveUpdatedRecords() { //@server...only records for the current temp student are being updated
    var uid;
    var updates = {};

    if (appEditor.appEditRecords.tempStudentRecords.length) {
        uid = firebase.auth().currentUser.uid;
        appEditor.appEditRecords.tempStudentRecords.forEach( function (el) {
            //if the record is marked for deletion, using "null" as the update, effectively deleting it from the db
            //note: if there are no records, then the student is also deleted (because: null)
            //ibid: if there are no students, the class wont exist (because: null)
            if ( el.hasOwnProperty("null_marked_for_deletion")) {
                if (el.null_marked_for_deletion === true) {
                    updates['assessments/' + uid + '/recordsIndex/' + el.recordKey] = null;
                    updates['assessments/' + uid + '/records/' + el.recordKey] = null;
                }
            } else {
                updates['assessments/' + uid + '/recordsIndex/' + el.recordKey] = createIndexObjForDb(el);
                updates['assessments/' + uid + '/records/' + el.recordKey] = removeRecordKeyFromObjForDb(el);
            }
        });

        firebase.database().ref().update(updates, function(e) {
            if (e) {
                chkPermission(e);
                displayMsg("a", e);
                return;
            }
            saveUpdateRecordsInAppEditor();
            displayMsg("r");
            buildRecordsMap(); //changes will be reflected onreload here
            exitUpdateRecords();
        });
    }
}

function graderNeedsStudentDataFromDb() {
    var uid;

    if (appEditor.db.students === false) {
        uid = firebase.auth().currentUser.uid;
        firebase.database().ref('assessments/' + uid + '/studentData').once('value').then(function(snapshot) {
            appEditor.db.students = true;
            appEditor.studentData = snapshot.val() || [];
            initStudentData();
            studentInfoHandlersOn();

            if (appEditor.db.snippets === false) { //JIT call to db for snippets
                getSnippetsFromDb();
            }
            initGrader();
        }, function (e) {
            chkPermission(e);
            return;
        });
    }
}

function getEverythingGraderNeedsFromDb() {
    var uid;

    if (appEditor.db.rubrics === false) {
        uid = firebase.auth().currentUser.uid;
        firebase.database().ref('assessments/' + uid + '/savedRubricsIndex').once('value').then(function(snapshot) {
            appEditor.db.rubrics = true;
            appEditor.rubricsIndex = snapshot.val() || {};
            if (appEditor.db.snippets === false) { //async call to db for snippets
                getSnippetsFromDb();
            }
            if (!isObjEmpty(appEditor.rubricsIndex)) {
                showEl("gaLoadChkBoxes");
                loadRubriks();
            }
            rubrikHandlersOn();
            graderNeedsStudentDataFromDb();
            return;
        }, function (e) {
            chkPermission(e);
            return;
        });
    } else if (appEditor.db.students === false) {
        graderNeedsStudentDataFromDb();
        return;
    } else {
        initGrader();
    }
}

function chkPermission(e) {
    var user,
        updates;

    if (e.code === "PERMISSION_DENIED"){
        user = firebase.auth().currentUser;

        if (user) {
            updates = {};
            updates['newUser/spk/' + user.uid] = user.displayName;
            firebase.database().ref().update( updates ).then( signOutOfApp() );
        } else {
            signOutOfApp(); //window.location = "../index.html";
        }
    }
}

function getRubricIndexesBeforeGetSnippets(uid) {
    firebase.database().ref('assessments/' + uid + '/savedRubricsIndex').once('value').then(function(snapshot) {
        appEditor.db.rubrics = true;
        appEditor.rubricsIndex = snapshot.val() || {};
        getSnippetsFromDb();

        if (!isObjEmpty(appEditor.rubricsIndex)) {
            showEl("ruLoadSelected");
            loadRubriks();
        }
        rubrikHandlersOn();
    }, function (e) {
        chkPermission(e);
        return;
    });
}

function getSnippetsFromDb() {
    var uid = firebase.auth().currentUser.uid;

    if (appEditor.db.rubrics === false) {
        getRubricIndexesBeforeGetSnippets(uid);
    } else {
        firebase.database().ref('assessments/' + uid + '/snippets').once('value').then(function(snapshot) {
            appEditor.db.snippets = true;
            appEditor.snippets = snapshot.val() || [];
            initSnippets();
            snippetHandlersOn();
        }, function (e) {
            chkPermission(e);
            return;
        });
    }
}

//TODO: user can view shared rubrics as an option btn click - default: not shown to user
function getRubricIndexesFromDb() {
    var uid = firebase.auth().currentUser.uid;

    firebase.database().ref('sharedRubrics/rubricsIndex').once('value').then(function(snapshot) {
        appEditor.sharedRubricsIndex = snapshot.val() || {};

        firebase.database().ref('assessments/' + uid + '/savedRubricsIndex').once('value').then(function(snapshot) {
            appEditor.rubricsIndex = snapshot.val() || {};
            appEditor.db.rubrics = true;

            if (!isObjEmpty(appEditor.rubricsIndex)) {
                showEl("ruLoadSelected");
                loadRubriks();
            }
            rubrikHandlersOn();
        }, function (e) {
            chkPermission(e);
            return;
        });
    }, function (e) {
        chkPermission(e);
        return;
    });
}

function getStudentsFromDb() {
    var uid = firebase.auth().currentUser.uid;

    firebase.database().ref('assessments/' + uid + '/studentData').once('value').then(function(snapshot) {
        appEditor.studentData = snapshot.val() || [];
        appEditor.db.students = true;
        initStudentData();
        studentInfoHandlersOn();
    }, function (e) {
        chkPermission(e);
        return;
    });
}

function getRecordsIndexFromDb() {
    var uid = firebase.auth().currentUser.uid;

    firebase.database().ref('assessments/' + uid + '/recordsIndex').once('value').then(function(snapshot) {
        var flatRec = flattenRecords(snapshot.val());

        appEditor.db.records = true;

        if (flatRec === false) { //false would be null
            appEditor.recordsIndex = [];
        }
        displayRecords();
        recordsHandlersOn();
    }, function (e) {
        chkPermission(e);
        return;
    });
}

function pushRecordsToDb(dataObj) {
    var uid = firebase.auth().currentUser.uid;
    var postData = {
        timeStamp : dataObj.timeStamp,
        context : dataObj.context,
        studentData : dataObj.studentData
        };
    var newPostKey = firebase.database().ref().child('assessments/' + uid + '/recordsIndex/').push().key;
    // Write the new post's data simultaneously to recordsIndex and records.
    var updates = {};
    updates['assessments/' + uid + '/recordsIndex/' + newPostKey] = postData;
    updates['assessments/' + uid + '/records/' + newPostKey] = dataObj;

    firebase.database().ref().update(updates, function(e) {
        if (e) {
            chkPermission(e);
            displayMsg("a", e);
            return;
        }
        displayMsg("s");
        if (appEditor.db.records === true) { addNewRecordToRecordsIndex(newPostKey, postData); }
        resetDataEntry();
    });
}

function getSelectedRubric(idx) {
    var uid = firebase.auth().currentUser.uid;

    firebase.database().ref('assessments/' + uid + '/savedRubrics/' + idx).once('value').then(function(snapshot) {
        appEditor.grader.loadedRubric = [];
        appEditor.grader.loadedRubric.push(snapshot.val());
        showSectionsForSelectedRubric(idx);
        finishInit();
    }, function (e) {
        chkPermission(e);
        displayMsg("y", e);
    });
}

function getRecordsIndexFromDbAtInit(uid, name) {
    firebase.database().ref('assessments/' + uid + '/recordsIndex').once('value').then(function(snapshot) {
        var flatRec = flattenRecords(snapshot.val());

        appEditor.db.records = true;
        initSuccess(name);

        if (flatRec === false) { //false would be null
            appEditor.recordsIndex = [];
        }
        displayRecords();
        recordsHandlersOn();
    }, function (err) {
        initFailed(name, false, err);
        return;
    });
}

function initFailed(name, bool, err) {
    var user,
        updates;

    if (err.code !== "PERMISSION_DENIED") { return; }

    user = firebase.auth().currentUser;

    if (user) {
        buildWelcomeMsg(name, bool);
        updates = {};
        updates['newUser/spk/' + user.uid] = user.displayName;
        firebase.database().ref().update( updates ).then( window.setTimeout( signOutOfApp, 7000 ) );
    } else {
        signOutOfApp(); //window.location = "../index.html";
    }
}

function initApp() {
    var uid = firebase.auth().currentUser.uid;
    var name = capitalizeUserName((firebase.auth().currentUser.displayName).split(" ")[0]);

    getRecordsIndexFromDbAtInit(uid, name);
}

//UTILS
function capitalizeUserName(str) {
    return str.replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
}

function displayMsg(num, eStr) { //ERROR DISPLAY
    var msgArr = {
        a: "Data could not be saved.\n" + eStr,
        b: "Snippets have been updated!",
        c: "" + eStr,
        d: "Rubric could not be created.\n" + eStr,
        e: "Rubric successfully saved!",
        ee: "Rubric is now being shared!",
        f: "Please select an existing rubric to load.",
        g: "A section with that name already exists!",
        h: "Please choose a valid name!",
        i: "Student information has been updated!",
        j: "ID numbers must be unique within each class!",
        k: "Some fields are missing!",
        l: "File requires all 3 headers: 'class', 'id' and 'name'.",
        m: "Not a (utf-8) .csv file!",
        n: "Data could not be found.\n" + eStr,
        o: "Record(s) deleted!",
        p: "Please select at least one record to edit.",
        q: "The class MUST be defined!",
        r: "Record changes were saved!",
        s: "Record was saved!",
        t: "Please choose a student!",
        u: "Please choose a score for each criteria.",
        v: "No relevant snippets available!",
        w: "Please specify the context!",
        x: "Please choose at least ONE section to grade!",
        y: "Cannot load the selected rubric\n" + eStr,
        z: "Given score exceeds the maximum score!"
    };
    var msg = msgArr[num] || "Error.";

    window.mscAlert({
        title: "",
        subtitle: msg
    });
}

function fixNewlinesInContentEditable(elId) {
    var patt0 = new RegExp("<div>","g");

    if (elId !== null) {
        docEl(elId).innerHTML = docEl(elId).innerHTML.replace(patt0," <div>");

        return cleanValue(docEl(elId).textContent);
    }
    return "";
}

function cleanWs(str) {
    return str.replace(/\s+/g,'');
}

function cleanTrailingWs(str) {
    return str.replace(/[\s\t]+$/, '');
}

function uniqueValues(arr) {
    var filtered = [];
    var len = arr.length;
    for (var i = 0; i < len; i++) {
        for (var j = i + 1; j < len; j++) {
            if (arr[i] === arr[j]) { // If a[i] is found later in the array...
                j = ++i;
            }
        }
        filtered.push(arr[i]);
    }
    return filtered;
}

function emptyContent(parentEl) {
    while (parentEl.hasChildNodes()) {
        while (parentEl.lastChild.hasChildNodes()) {
            parentEl.lastChild.removeChild(parentEl.lastChild.lastChild);
        }
        parentEl.removeChild(parentEl.lastChild);
    }
}

function getKeyGivenValue(obj, value) {
    return Object.keys(obj)[Object.values(obj).indexOf(value)];
}

function stripHtmlFromText(str) { //strip markup from content pasted into editable div
    return str.replace(/(<([^>]+)>)/ig,"");
}

function getPaste(e) {
    var text;

    e.preventDefault();
    text = (e.originalEvent || e).clipboardData.getData("text/plain");
    text = stripHtmlFromText(text);
    document.execCommand("insertText", false, text);
}

function numsOnly(str) {
    return Number((str.replace(/[^0-9\.]/gmi, '').replace(/[\s\t]+$/, '')));
}

function isObjEmpty(obj) {
    if (obj === null) {
        return true;
    }
    else if (typeof obj !== "object") {
        return true;
    } else {
        return Object.keys(obj).length === 0; //true if obj is empty, false if has prop.s
    }
}

function cleanValue(name) {
    return ((name.replace(/\s+/g,' ')).replace(/^\s+|\s+$/g, ''));
}

function uniqueNestedArrs(arrayOfArrays, idx) { //using this to filter dup. id.s (numbers) from getCandidatesByClass()
    var filtered = [];
    var len = arrayOfArrays.length;
    var i,
        j;

    for (i = 0; i < len; i++) {
        for (j = i + 1; j < len; j++) {
            if (arrayOfArrays[i][idx] === arrayOfArrays[j][idx]) { // If a[i][idx] is found later in the array...
                j = ++i;
            }
        }
        filtered.push(arrayOfArrays[i]);
    }
    return filtered;
}

function charsToUnderscore(str) {
    str = (str.replace(/[^a-zA-Z\0-9\-\u3130-\u318F\uAC00-\uD7AF\_]/gmi, '_')).replace(/\s/g, '_');
    return str;
}

function getGenScoreForNoRubric(elId1, elId2) {
    var scr = Number(numsOnly(docEl(elId1).value));
    var max = Number(numsOnly(docEl(elId2).value));
    var returnArr = ["",""];

    if (scr !== NaN && max !== NaN ) {
        returnArr[0] = "" + scr;
        returnArr[1] = "" + max;
    }
    if (scr > max) {
        displayMsg("z");
        returnArr[0] = "error";
    }
    return returnArr;
}

//RUBRICS
function newRubrik() {
    appEditor.editorIsOpen.rubric = true;
    appEditor.appEditRecords.loadedRubric = [];
    docEl("ac_ru_del").style.display = "none";
    hideEl("ruCreateNew");
    hideEl("ruLoadSelected");
    hideEl("ruLoadChkBoxes");
    showEl("ruNewRubricName");
    newRubrikHandlersOn();
}

function initNewRubrik() {
    var named = docEl("ruEnterNewName").value;

    if (named === "") {
        displayMsg("h");
        return;
    }
    appEditor.editorIsOpen.rubric = true;
    docEl("ruNameNewtxt").value = named;
    showEl("ruNameCurrent");
    showEl("sectionInputWrapper");
    showEl("rubricActions");
    newRubrikHandlersOffAndExit();
}

function coldExitNewRubrik() {
    appEditor.editorIsOpen.rubric = false;
    docEl("ruEnterNewName").value = "";
    showEl("ruCreateNew");
    hideEl("ruLoadSelected");
    showEl("ruLoadChkBoxes");
    newRubrikHandlersOffAndExit();

    if (appEditor.rubricsIndex.length) { showEl("ruLoadSelected"); }
}

function createNewSectionTable(tableId) {
    if (!appEditor.tableObj.hasOwnProperty(tableId)) { // when NOT loading an existing rubrik
        appEditor.tableObj[tableId] = [["", "", "", "", "", "", ""], ["", "", "", "", "", "", ""], ["", "", "", "", "", "", ""], ["", "", "", "", "", "", ""], ["", "", "", "", "", "", ""], ["", "", "", "", "", "", ""]];
    }
    appEditor.table_Id = "" + tableId;

    var container = docEl("rubrik");
    var frag = document.createDocumentFragment();
    var newTable = document.createElement("table");
    var newThead = document.createElement("thead");
    var newTbody = document.createElement("tbody");
    var newDiv1 = document.createElement("div");
    var newDiv2 = document.createElement("div");
    var newDiv3 = document.createElement("div");
    var newInput1 = document.createElement("input");
    var newBtn1 = document.createElement("button");
    var newBtn2 = document.createElement("button");

    newDiv3.id = "hn" + tableId;
    newDiv3.className = "sectionNameEdit nodisplay";
    newInput1.id = "ht" + tableId;
    newInput1.dataset.oldval = "";
    newBtn1.id = "hk-" + tableId;
    newBtn1.className = "btn btn-sm btn-whiteBlue";
    newBtn1.textContent = "Rename section";
    newBtn2.id = "hz-" + tableId;
    newBtn2.className = "btn btn-sm btn-default";
    newBtn2.textContent = "Cancel";
    newTable.className = "spreadsheet__table";
    newThead.id = "table-headers-" + tableId;
    newThead.className = "spreadsheet__table--headers";
    newTbody.className = "spreadsheet__table--body";
    newTbody.id = "table-body-" + tableId;
    newDiv1.id = "hs-" + tableId;
    newDiv1.className = "btn btn-xs btn-blueYellow pull-right spreadSheetBtn";
    newDiv1.textContent = "Reset section";
    newDiv2.id = "hd-" + tableId;
    newDiv2.className = "btn btn-xs btn-dangerous pull-right spreadSheetBtn";
    newDiv2.textContent = "Delete section";

    newDiv3.appendChild(newInput1);
    newDiv3.appendChild(newBtn1);
    newDiv3.appendChild(newBtn2);
    newTable.appendChild(newThead);
    newTable.appendChild(newTbody);
    frag.appendChild(newDiv3);
    frag.appendChild(newTable);
    frag.appendChild(newDiv2);
    frag.appendChild(newDiv1);
    container.appendChild(frag);
}

function initializeData() {
    var defaultRowCount = 5; //init num of blank rows
    var defaultColCount = 6; //init num of blank cols
    var data = [];
    var child;

    for (var i = 0; i <= defaultRowCount; i++) {
        child = [];
        for (var j = 0; j <= defaultColCount; j++) {
            child.push("");
        }
        data.push(child);
    }
    return data;
}

function getData() {
    var data = appEditor.tableObj[appEditor.table_Id];

    if (data === undefined || data === null) { return initializeData(); }
    return data;
}

function saveData(data) {
    appEditor.tableObj[appEditor.table_Id] = data;
}

function resetData(tableId, bool) {
    appEditor.tableObj[tableId] = initializeData();
    createSpreadsheet(bool);
}

function createHeaderRow(defaultColCount) {
    var tr = document.createElement("tr");
    var i;

    tr.setAttribute("id", "hh-0-" + appEditor.table_Id);
    for (i = 0; i <= defaultColCount; i++) {
        var th = document.createElement("th");
        th.setAttribute("id", "hb-0-" + i + "-" + appEditor.table_Id);
        th.setAttribute("class", '' + (i === 0 ? "" : "column-header"));
        if (i !== 0) {
            var span = document.createElement("span");

            if (i > 1) {
                span.setAttribute("class", "column-header-span");

                var dropDownDiv = document.createElement("div");
                var newBtn = document.createElement("button");
                var newDiv = document.createElement("div");
                var newP1 = document.createElement("p");
                var newP2 = document.createElement("p");
                var newP3 = document.createElement("p");

                dropDownDiv.setAttribute("class", "dropdown");
                newBtn.id = "hx-dropbtn-" + i + "-" + appEditor.table_Id + "";
                newBtn.className = "dropbtn";
                newDiv.id = "hx-dropdown-" + i + "-" + appEditor.table_Id + "";
                newDiv.className = "dropdown-content";
                newP1.className = "col-insert-left";
                newP1.textContent = "Insert column left";
                newP2.className = "col-insert-right";
                newP2.textContent = "Insert column right";
                newP3.className = "col-delete";
                newP3.textContent = "Delete column";

                newDiv.appendChild(newP1);
                newDiv.appendChild(newP2);
                newDiv.appendChild(newP3);
                dropDownDiv.appendChild(newBtn);
                dropDownDiv.appendChild(newDiv);
                th.appendChild(span);
                th.appendChild(dropDownDiv);
            }
        }
        tr.appendChild(th);
    }
    return tr;
}

function createTableBodyRow(rowNum, defaultColCount) {
    var tr = document.createElement("tr");
    tr.setAttribute("id", 'hr-' + rowNum + "-" + appEditor.table_Id);

    for (var i = 0; i <= defaultColCount; i++) {
        var cell = document.createElement('td');

        if (i === 0) {
            cell.contentEditable = false;

            if (rowNum > 1) {
                var span = document.createElement("span");
                var dropDownDiv = document.createElement("div");
                var newBtn = document.createElement("button");
                var newDiv = document.createElement("div");
                var newP1 = document.createElement("p");
                var newP2 = document.createElement("p");
                var newP3 = document.createElement("p");

                dropDownDiv.setAttribute("class", "dropdown");
                newBtn.id = "hy-dropbtn-" + rowNum + "-" + appEditor.table_Id + "";
                newBtn.className = "dropbtn";
                newDiv.id = "hy-dropdown-" + rowNum + "-" + appEditor.table_Id + "";
                newDiv.className = "dropdown-content";
                newP1.className = "row-insert-top";
                newP1.textContent = "Insert row above";
                newP2.className = "row-insert-bottom";
                newP2.textContent = "Insert row below";
                newP3.className = "row-delete";
                newP3.textContent = "Delete row";

                newDiv.appendChild(newP1);
                newDiv.appendChild(newP2);
                newDiv.appendChild(newP3);
                dropDownDiv.appendChild(newBtn);
                dropDownDiv.appendChild(newDiv);
                cell.appendChild(span);
                cell.appendChild(dropDownDiv);
            }
            cell.setAttribute("class", "row-header");
        } else if (i === 1 && rowNum === 1) {
            cell.contentEditable = false;
            cell.setAttribute("class", "criterias");
        } else {
            cell.contentEditable = true;
        }
        cell.setAttribute("id", 'hr-' + rowNum + '-' + i + "-" + appEditor.table_Id);
        tr.appendChild(cell);
    }
    return tr;
}

function createTableBody(tableBody, defaultRowCount, defaultColCount) {
    var rowNum;

    for (rowNum = 1; rowNum <= defaultRowCount; rowNum++) {
        tableBody.appendChild(createTableBodyRow(rowNum, defaultColCount));
    }
}

function populateTable() {
    var data = getData();
    var cell,
        i,
        j;

    if (data === undefined || data === null) { return; }

    for (i = 1; i < data.length; i++) {
        for (j = 1; j < data[i].length; j++) {
            cell = docEl('hr-' + i + '-' + j + '-' + appEditor.table_Id);
            cell.textContent = data[i][j];
        }
    }
}

function addRow(currentRow, direction) {
    var data = getData();
    var colCount = data[0].length;
    var newRow = new Array(colCount).fill("");

    if (direction === "top") { data.splice(currentRow, 0, newRow); }
    if (direction === "bottom") { data.splice(currentRow + 1, 0, newRow); }

    saveData(data);
    createSpreadsheet(false);
}

function addColumn(currentCol, direction) {
    var data = getData();
    var rowCount = data.length;
    var i;

    for (i = 0; i < rowCount; i++) {
        if (direction === "left") { data[i].splice(currentCol, 0, ""); }
        if (direction === "right") { data[i].splice(currentCol + 1, 0, ""); }
    }
    saveData(data);
    createSpreadsheet(false);
}

function deleteRow(currentRow) {
    var data = getData();

    if (data.length <= 3) { return false; } //prevent removal of last existing criteria row

    data.splice(currentRow, 1);
    saveData(data);
    createSpreadsheet(false);
}

function deleteColumn(currentCol) {
    var data = getData();
    var rowCount = data.length;
    var colCount = data[0].length;
    var i;

    if (colCount <= 3) { return false; } //prevent removal of last existing score column

    for (i = 0; i < rowCount; i++) {
        data[i].splice(currentCol, 1);
    }
    saveData(data);
    createSpreadsheet(false);
}

function tableFocus(e) {
    var item,
        indices,
        spreadsheetData;

    if (e.target !== e.currentTarget) {
        if (e.target && e.target.nodeName === "TD") {
            item = e.target.id;
            indices = item.split("-");
            appEditor.table_Id = "" + indices[3];
            spreadsheetData = getData();
            //TODO:
            spreadsheetData[indices[1]][indices[2]] = fixNewlinesInContentEditable(item); //docEl(item).textContent;
            saveData(spreadsheetData);
        }
        e.stopPropagation();
    }
}

function rowName(e) {
    var idxArr = e.target.id.split("-");

    if (idxArr[0] === "hr" && idxArr[1] === "1" && idxArr[2] === "1") {
        appEditor.table_Id = "" + idxArr[3];
        renameSection(idxArr[3]);
    }
}

function rowDown(e) {
    var idxArr = e.target.id.split("-");

    appEditor.table_Id = "" + idxArr[3];
    docEl('hy-dropdown-' + idxArr[2] + "-" + appEditor.table_Id).classList.toggle("show");
}

function rowTop(e) {
    var idxArr = e.target.parentNode.id.split("-");

    appEditor.table_Id = "" + idxArr[3];
    addRow(parseInt(idxArr[2]), "top");
}

function rowBtm(e) {
    var idxArr = e.target.parentNode.id.split("-");

    appEditor.table_Id = "" + idxArr[3];
    addRow(parseInt(idxArr[2]), "bottom");
}

function rowDel(e) {
    var idxArr = e.target.parentNode.id.split("-");

    appEditor.table_Id = "" + idxArr[3];
    deleteRow(parseInt(idxArr[2]));
}

function colDown(e) {
    var idx = e.target.id.split("-");

    appEditor.table_Id = "" + idx[3];
    docEl('hx-dropdown-' + idx[2] + "-" + appEditor.table_Id).classList.toggle("show");
}

function colLeft(e) {
    var idx = e.target.parentNode.id.split("-");

    appEditor.table_Id = "" + idx[3];
    addColumn(parseInt(idx[2]), "left");
}

function colRight(e) {
    var idx = e.target.parentNode.id.split("-");

    appEditor.table_Id = "" + idx[3];
    addColumn(parseInt(idx[2]), "right");
}

function colDel(e) {
    var idx = e.target.parentNode.id.split("-");

    appEditor.table_Id = "" + idx[3];
    deleteColumn(parseInt(idx[2]));
}

function renameSection(tableId) {
    docEl("ht" + tableId).value = appEditor.table_lookup[tableId];
    docEl("ht" + tableId).setAttribute("data-oldval", appEditor.table_lookup[tableId]);
    showEl("hn" + tableId);
}

function chkDupOnChange(newName, currentName) {
    var isDup = dupSectionName(newName);

    if (isDup === true) {
        if (newName === currentName) { isDup = false; }
    }
    return isDup;
}

function applySectionNameChange(tableId) {
    var elId = "ht" + tableId;
    var currentName = docEl(elId).dataset.oldval;
    var objKey = getKeyGivenValue(appEditor.table_lookup, currentName);
    var newName = docEl(elId).value;
    var isDup = chkDupOnChange(newName, currentName);

    if (isDup === true) {
        docEl(elId).value = "";
        displayMsg("g");
        return;
    }
    appEditor.table_lookup[objKey] = newName;
    appEditor.table_Id = "" + newName;
    docEl(elId).dataset.oldval = "";
    docEl("hr-1-1-" + objKey).textContent = newName;
    renameSectionExit(tableId);
}

function renameSectionExit(tableId) {
    hideEl("hn" + tableId);
    docEl("ht" + tableId).value = "";
}

function resetRenameOk(indices) {
    appEditor.table_Id = "" + indices[1];
    applySectionNameChange(indices[1]);
}

function resetRenameExit(indices) {
    appEditor.table_Id = "" + indices[1];
    renameSectionExit(indices[1]);
}

function resetReset(indices) {
    appEditor.table_Id = "" + indices[1];
    window.mscConfirm({
        title: '',
        subtitle: 'This will reset all data in this section! Are you sure?',
        cancelText: 'Exit',
        onOk: function () {
            resetData(appEditor.table_Id, false);
        },
        onCancel: function () {
            return;
        }
    });
}

function resetDelete(indices) {
    appEditor.table_Id = "" + indices[1];
    window.mscConfirm({
        title: '',
        subtitle: 'This will delete all data in this section! Are you sure?',
        cancelText: 'Exit',
        onOk: function () {
            deleteSection(indices[1]);
        },
        onCancel: function () {
            return;
        }
    });
}

function closeDropBtn(e) { //Close the dropdown menu if the user clicks outside of it #editRubric
    var dropdowns,
        openDropdown,
        i;

    if (!e.target.matches(".dropbtn")) {
        dropdowns = document.getElementsByClassName("dropdown-content");

        for (i = 0; i < dropdowns.length; i++) {
            openDropdown = dropdowns[i];

            if (openDropdown.classList.contains("show")) { openDropdown.classList.remove("show"); }
        }
    }
}

function dupSectionName(val) {
    var allKeys = Object.keys(appEditor.tableObj);
    var returnVal = false;
    var i;

    if (allKeys.length) {
        for (i = 0; i < allKeys.length; i++) {
            if (appEditor.table_lookup[allKeys[i]] === val) {
                returnVal = true;
                break;
            }
        }
    }
    return returnVal;
}

function initNewSectionFromNew() {
    var val = docEl("newRubrikSection").value;
    var bool = dupSectionName(val);
    var lookupKeys = Object.keys(appEditor.table_lookup);
    var lastIndex,
        newIndex;

    if (lookupKeys.length > 0) {
        lastIndex = lookupKeys.length - 1;
        lookupKeys = lookupKeys.sort();
        newIndex = "table" + (Number((lookupKeys[lastIndex]).substring(5)) + 1);
    } else {
        newIndex = "table0";
    }
    appEditor.table_lookup[newIndex] = val;
    initNewSection(val, bool);
}

function initNewSectionFromLoad(sectionId) {
    initNewSection(sectionId, false);
}

function convertToRubricObj(rubrikName) {
    var keys = Object.keys(appEditor.tableObj);
    var newRubrik = {};
    var newSection;
    var newCriteria;
    var newDef;
    var i,
        ii,
        iii;

    newRubrik.rubricName = rubrikName;
    newRubrik.rubricDef = [];

    for (i = appEditor.appEditRecords.loadedRubric.length - 1; i >= 0; i--) {
        if (appEditor.appEditRecords.loadedRubric[i].rubricName === rubrikName) {
            appEditor.appEditRecords.loadedRubric.splice(i, 1);
        }
    }
    for (i = 0; i < keys.length; i++) {
        newSection = {};
        newSection.sectionName = appEditor.table_lookup[keys[i]]; //newSection.sectionName = keys[i];
        newSection.sectionDef = [];

        for (ii = 2; ii < appEditor.tableObj[keys[i]].length; ii++) {
            newCriteria = {};
            newCriteria.criteriaName = appEditor.tableObj[keys[i]][ii][1];
            newCriteria.criteriaDef = [];

            for (iii = 2; iii < appEditor.tableObj[keys[i]][ii].length; iii++) {
                newDef = {};
                newDef.score = appEditor.tableObj[keys[i]][1][iii];
                newDef.descriptor = appEditor.tableObj[keys[i]][ii][iii];
                newCriteria.criteriaDef.push(newDef);
            }
            newSection.sectionDef.push(newCriteria);
        }
        newRubrik.rubricDef.push(newSection);
    }
    return newRubrik;
}

function allChksPassForNewRubrik() {
    var returnVal = "true";
    var tblObj = appEditor.tableObj;
    var sectionKeys = Object.keys(tblObj);
    var eachSection,
        uniqLenChk,
        dupsArr,
        i,
        ii,
        iii;

    if (docEl("ruNameNewtxt").value === "") { return "Please give the rubric a name!"; }
    if (!sectionKeys.length) { return "Please add at least one section!"; }

    for (i = 0; i < sectionKeys.length; i++) {
        if (sectionKeys[i] === "") {
            returnVal = "Please provide names for all sections!";
            break;
        }
        eachSection = sectionKeys[i];

        if (tblObj[eachSection].length < 3) {
            returnVal = "Please provide at least one criteria!";
            break;
        }

        for (ii = 2; ii < tblObj[eachSection].length; ii++) {
            if (tblObj[sectionKeys[i]][ii].length < 3) {
                returnVal = "Please provide at least one score!";
                break;
            }
            if (tblObj[sectionKeys[i]][ii][1] === "") {
                returnVal = "Please provide names for all criterias!";
                break;
            }

            for (iii = 2; iii < tblObj[eachSection][ii].length; iii++) {
                if (tblObj[eachSection][1][iii] === "" || !!isNaN(tblObj[eachSection][1][iii])) {
                    returnVal = "All scores are required and must be numerical!";
                    break;
                }
            }
            dupsArr = uniqueValues(tblObj[eachSection][1]);
            uniqLenChk = tblObj[eachSection][1].length - dupsArr.length; //...+1 difference because the first two elements === ""

            if (uniqLenChk !== 1) {
                returnVal = "Please ensure that the scores within each section are unique (no duplicate scores)!";
                break;
            }
        }
    }
    return returnVal;
}

function exitEditRubrics() {
    var sectionKeys = Object.keys(appEditor.tableObj);
    var i;

    for (i = 0; i < sectionKeys.length; i++) {
        removeOldListeners(sectionKeys[i]);
    }
    emptyContent(docEl("rubrik"));
    appEditor.tableObj = {};
    appEditor.table_Id = "";
    appEditor.table_lookup = {};
    appEditor.editorIsOpen.rubric = false;
    hideEl("ruNameCurrent");
    docEl("ruNameNewtxt").value = "";
    docEl("ruEnterNewName").value = "";
    hideEl("ruNewRubricName");
    hideEl("sectionInputWrapper");
    hideEl("rubricActions");
    docEl("ac_ru_del").style.display = "none";

    if (appEditor.rubricsIndex.length) { showEl("ruLoadSelected"); }

    showEl("ruCreateNew");
    showEl("ruLoadChkBoxes");
}

function discardRubrik() {
    if (appEditor.appEditRecords.loadedRubric.length) { showEl("ruLoadSelected"); }
    exitEditRubrics();
}

function convertFromRubrikObj() {
    var selectedRubik = appEditor.appEditRecords.loadedRubric[0];
    var allSectionNames = [];
    var nestedArr,
        defaultRowCount,
        defaultColCount,
        newTableLookup,
        i,
        ii,
        iii;

    for (i = 0; i < selectedRubik.rubricDef.length; i++) {
        allSectionNames.push(selectedRubik.rubricDef[i].sectionName);
    }
    allSectionNames = fixLoadedRubrikDupSections(allSectionNames); //any dup name issues must be resolved FIRST!

    for (i = 0; i < selectedRubik.rubricDef.length; i++) {
        selectedRubik.rubricDef[i].sectionName = allSectionNames[i];
    }
    appEditor.tableObj = {};

    for (i = 0; i < selectedRubik.rubricDef.length; i++) { //defaultRowCount and defaultColCount can be different for each section...
        defaultRowCount = selectedRubik.rubricDef[i].sectionDef.length + 2;
        defaultColCount = selectedRubik.rubricDef[i].sectionDef[0].criteriaDef.length + 2;
        newTableLookup = "table" + i;
        appEditor.tableObj[newTableLookup] = [];
        appEditor.table_lookup[newTableLookup] = selectedRubik.rubricDef[i].sectionName;

        for (ii = 0; ii < defaultRowCount; ii++) {
            nestedArr = new Array(defaultColCount).fill("");
            appEditor.tableObj[newTableLookup].push(nestedArr);
        }
    }

    for (i = 0; i < selectedRubik.rubricDef.length; i++) {
        newTableLookup = getKeyGivenValue(appEditor.table_lookup, selectedRubik.rubricDef[i].sectionName);
        defaultRowCount = selectedRubik.rubricDef[i].sectionDef.length + 2;
        defaultColCount = selectedRubik.rubricDef[i].sectionDef[0].criteriaDef.length + 2;

        for (ii = 2; ii < defaultRowCount; ii++) {
            appEditor.tableObj[newTableLookup][ii][1] = selectedRubik.rubricDef[i].sectionDef[ii - 2].criteriaName;

            for (iii = 2; iii < defaultColCount; iii++) {
                appEditor.tableObj[newTableLookup][1][iii] = selectedRubik.rubricDef[i].sectionDef[ii - 2].criteriaDef[iii - 2].score;
                appEditor.tableObj[newTableLookup][ii][iii] = selectedRubik.rubricDef[i].sectionDef[ii - 2].criteriaDef[iii - 2].descriptor;
            }
        }
    }
    return allSectionNames;
}

//TODO
function displayAvailableRubriks(available, shared) {
    var i;

    emptyContent(docEl("ruLoadChkBoxes"));

    if (available.length) {
        for (i = 0; i < available.length; i++) {
            createAvailableRubriksButtons(available[i], true);
        }
    }
    if (shared.length) {
        createAvailableRubriksDivider();

        for (i = 0; i < shared.length; i++) {
            createAvailableRubriksButtons(shared[i], false);
        }
    }
    showEl("ruLoadSelected");
}

//TODO
function loadRubriks() { //init
    docEl("shareThisRubric").checked = false;
    displayAvailableRubriks(Object.keys(appEditor.rubricsIndex), Object.keys(appEditor.sharedRubricsIndex));
}

function getDupsFromArr(arr) {
    var duplicates = {};
    var i;

    for (i = 0; i < arr.length; i++) {
        if (duplicates.hasOwnProperty(arr[i])) {
            duplicates[arr[i]].push(i);
        } else if (arr.lastIndexOf(arr[i]) !== i) {
            duplicates[arr[i]] = [i];
        }
    }
    return duplicates;
}

function fixLoadedRubrikDupSections(allSectionNames) {
    var dupsObj = getDupsFromArr(allSectionNames);
    var dupKeys = Object.keys(dupsObj);
    var dupIndexes,
        i,
        ii;

    for (i = 0; i < dupKeys.length; i++) {
        dupIndexes = dupsObj[dupKeys[i]];

        for (ii = 0; ii < dupIndexes.length; ii++) {
            if (ii > 0) { allSectionNames[dupIndexes[ii]] = allSectionNames[dupIndexes[ii]] + "(" + ii + ")"; }
        }
    }
    return allSectionNames;
}

//TODO:
function getSelectedRubrik(rubricNameKey, bool) { //bool === false: take shared rubrik
    var uid = firebase.auth().currentUser.uid;
    var path = 'assessments/' + uid + '/savedRubrics/' + rubricNameKey;
    var selectedRubik;

    if (rubricNameKey === "" || rubricNameKey == undefined) {
        displayMsg("f");
        return;
    }
    if (bool === false) {
        path = 'sharedRubrics/rubrics/' + rubricNameKey;
    }
    firebase.database().ref(path).once('value').then(function (snapshot) {
        selectedRubik = snapshot.val();

        if (selectedRubik !== null) {
            appEditor.appEditRecords.loadedRubric = [];
            appEditor.appEditRecords.loadedRubric.push(selectedRubik);
            appEditor.appEditRecords.loadedRubric[0].rubricKey = rubricNameKey;
            if (bool === false) {
                appEditor.appEditRecords.loadedRubric[0].isFromShared = true;
            }
            showLoadedRubrik();
        }
    }, function (e) {
        chkPermission(e);
    });
}

//TODO
function selectLoadedRubrik() {
    var allRubrikBtns = document.getElementsByName('scalor');
    var rubricNameKey,
        isShared,
        i;

    for (i = 0; i < allRubrikBtns.length; i++) {
        if (allRubrikBtns[i].checked) {
            rubricNameKey = allRubrikBtns[i].value;
            isShared = allRubrikBtns[i].dataset.share;
            break;
        }
    }
    if (!isShared) {
        getSelectedRubrik(rubricNameKey, true);
        return;
    }
    getSelectedRubrik(rubricNameKey, false);
}

function showLoadedRubrik() {
    var rubrikKeys = [];
    var i;

    showEl("ruNameCurrent");
    docEl("ruNameNewtxt").value = appEditor.appEditRecords.loadedRubric[0].rubricName;
    docEl("shareThisRubric").checked = false;
    rubrikKeys = convertFromRubrikObj(); //returns the correct order of sections from appEditor.appEditRecords.loadedRubric...

    for (i = 0; i < rubrikKeys.length; i++) {
        appEditor.table_Id = "" + rubrikKeys[i];
        initNewSectionFromLoad(rubrikKeys[i]);
    }
    appEditor.editorIsOpen.rubric = true;
    hideEl("ruLoadChkBoxes");
    hideEl("ruLoadSelected");
    hideEl("ruCreateNew");
    showEl("sectionInputWrapper");
    showEl("rubricActions");
    docEl("ac_ru_del").style.display = "block";
}

//TODO:
function rubricCommitted(key, idxObj, newShareKey) {
    appEditor.rubricsIndex[key] = idxObj;

    if (newShareKey !== undefined) {
        appEditor.sharedRubricsIndex[newShareKey] = idxObj;
    }
    appEditor.appEditRecords.loadedRubric = [];
    updateSnippetRubricTags();
    loadRubriks();
    exitEditRubrics();
    enableEl("editRubric");
    displayMsg("e");
}

function idxObjFromRubricPostData(postData) {
    var newRubricIndexObj = { "rubricName": postData.rubricName, "sectionNames": [] };

    newRubricIndexObj.sectionNames = postData.rubricDef.map(function (el) { return el.sectionName; }); //get all sectionNames from postData
    return newRubricIndexObj;
}

function commitRubrik() {
    var uid = firebase.auth().currentUser.uid;
    var chkd = allChksPassForNewRubrik();
    var rubricName = docEl("ruNameNewtxt").value;
    var relevantKey;

    if (appEditor.editorIsOpen.rubric === false) { return; }
    if (chkd !== "true") {
        displayMsg("c", chkd);
        return;
    }
    disableEl("editRubric");

    if (appEditor.appEditRecords.loadedRubric[0] == undefined) {
        rubricSaveAsNew(rubricName, uid); //undefined if this is a new rubric...
        return;
    }
    //TODO:
    if (appEditor.appEditRecords.loadedRubric[0].hasOwnProperty("isFromShared") && appEditor.appEditRecords.loadedRubric[0].isFromShared === true) {
        rubricSaveAsNew(rubricName, uid); //user has modified a shared rubric...
        return;
    }
    relevantKey = appEditor.appEditRecords.loadedRubric[0].rubricKey;
    window.mscConfirm({
        title: '',
        subtitle: 'What would you like to do?',
        okText: 'Update this rubric',
        cancelText: 'Save as new rubric',
        onOk: function () {
            rubricUpdateExisting(rubricName, relevantKey, uid);
        },
        onCancel: function () {
            rubricName += "-" + window.Date.now();
            rubricSaveAsNew(rubricName, uid);
        }
    });
}

function rubrikDestroyed(key) {
    delete appEditor.rubricsIndex[key];
    appEditor.appEditRecords.loadedRubric = [];
    hideEl("ruLoadSelected");
    exitEditRubrics();
    loadRubriks();
    updateSnippetRubricTags();
}

function destroyRubrik() {
    window.mscConfirm({
        title: 'Warning!',
        subtitle: 'You are about to delete rubric: ' + appEditor.appEditRecords.loadedRubric[0].rubricName + '\nAre you sure?',
        cancelText: 'Exit',
        onOk: function () {
            removeRubrikFromDb(appEditor.appEditRecords.loadedRubric[0].rubricKey);
        },
        onCancel: function () {
            return;
        }
    });
}

//RUBRICS IN GRADER

function getGenScoreForNoRubric(elId1, elId2) {
    var scr = Number(numsOnly(docEl(elId1).value));
    var max = Number(numsOnly(docEl(elId2).value));
    var returnArr = ["",""];

    if (scr !== NaN && max !== NaN ) {
        returnArr[0] = "" + scr;
        returnArr[1] = "" + max;
    }
    if (scr > max) {
        displayMsg("z");
        returnArr[0] = "error";
    }
    return returnArr;
}

function getSectionNames(arr) {
    var allSections = arr.map(function (el) { return el.sectionName; });

    return allSections;
}

//active sections only from appEditor.grader.rubricFilter -> a slimmer rubric object that has the sections in the same order as appEditor.grader.tempRecord.activeSections
//using this to build appEditor.grader.tempRecord -> appEditor.grader.tempRecord.scores MUST be in the same array order as temp.rubric!
function createSlimRubric() {
    var newRubric = [];

    for (var i = 0; i < appEditor.grader.tempRecord.activeSections.length; i++) {
        newRubric.push(appEditor.grader.rubricFilter[appEditor.grader.tempRecord.activeSections[i]]); //newRubric is not a reference!
    }
    return newRubric;
}

function loadGraderRubriks() {
    var keysArr = Object.keys(appEditor.rubricsIndex);
    var len = keysArr.length;
    var i;

    hideEl("gaLoading");
    emptyContent(docEl("gaLoadChkBoxes"));
    createNoRubricGradingRubrikButton(); //default: no rubric

    if (len) {
        for (i = 0; i < len; i++) {
            createGradingRubriksButtons(keysArr[i], appEditor.rubricsIndex[keysArr[i]].rubricName);
        }
        setUpHandlersOn();
        appEditor.editorIsOpen.graderSetup = true;
    }
}

function getNoRubricRubric() {
    appEditor.grader.noRubricCommentsOnly = true;
    appEditor.grader.loadedRubric = [];
    showSectionsForSelectedRubric(null);
    finishInit();
}

function addSelectedToActiveSectionsArr(sectionIndex) {
    var allSectionKeys = getSectionNames(appEditor.grader.rubricFilter);

    if (sectionIndex !== "" && sectionIndex !== "undefined") {
        if (appEditor.grader.tempRecord.activeSections.indexOf(sectionIndex) === -1 && allSectionKeys[sectionIndex] !== "undefined") {
            appEditor.grader.tempRecord.activeSections.push(sectionIndex);
        }
    }
    updateSetupNums();
}

function removeSelectedFromActiveSectionsArr(sectionIndex) {
    var index = appEditor.grader.tempRecord.activeSections.indexOf(sectionIndex);

    if (index !== -1) { appEditor.grader.tempRecord.activeSections.splice(index, 1); }
    updateSetupNums();
}

function updateSetupNums() {
    var targetLength = appEditor.grader.tempRecord.activeSections.length;
    var allSectionsLength = getSectionNames(appEditor.grader.rubricFilter).length;
    var targetId;
    var i;

    for (i = 0; i < allSectionsLength; i++) { //clear all helper numbers...
        targetId = "gs" + i;
        docEl(targetId).textContent = "";
    }
    if (targetLength > 0) { //update all helper numbers on the UI (next to each chkbx)
        for (i = 0; i < targetLength; i++) {
            targetId = "gs" + appEditor.grader.tempRecord.activeSections[i]; //the target helper number div
            docEl(targetId).textContent = (i + 1);
        }
    }
}

function setTempRecordScore(idxArr) {
    appEditor.grader.tempRecord.scores[idxArr[0]][idxArr[1]] = [];
    appEditor.grader.tempRecord.scores[idxArr[0]][idxArr[1]] = idxArr; //.push(idxArr[0], idxArr[1], idxArr[2]);
}

function updateGradingDescriptorOnScoreChange(criteriaId) { //"gf" + sectionIndex + "-" + criteriaIdx + "-" + selectedIndex
    var idx = docEl(criteriaId).selectedIndex - 1; //placeholder: "" @selectedIndex[0]
    var descr;
    var idxArr = (criteriaId.substring(2)).split("-");

    if (idxArr.length === 3) {
        idxArr[0] = Number(idxArr[0]);
        idxArr[1] = Number(idxArr[1]);
        idxArr[2] = idx;

        if (idx !== -1) {
            setTempRecordScore(idxArr);
            descr = appEditor.grader.rubric[idxArr[0]].sectionDef[idxArr[1]].criteriaDef[idx].descriptor;
            docEl("gf" + idxArr[0] + "-" + idxArr[1] + "-3").textContent = descr;
        } else {
            appEditor.grader.tempRecord.scores[idxArr[0]][idxArr[1]] = []; //clear tempRecordScore
            docEl("gf" + idxArr[0] + "-" + idxArr[1] + "-3").textContent = "";
        }
    }
}

function populateGraderUI() {
    var len = appEditor.grader.rubric.length;
    var i;

    docEl("titleHeader").textContent = appEditor.grader.tempRecord.context;
    createUISections();

    for (i = 0; i < len; i++) { //each section table here
        createSectionElTables(i);
    }
    for (i = 0; i < len; i++) {
        createGradingCriteriasEl(i);
    }
}

//RECORDS

//DOWNLOADING RECORDS

function getTextAsImageURI(txt) {
    var canvas = docEl("txtCanvas");
    var ctx = canvas.getContext("2d");

    ctx.font = "30px Arial";
    ctx.fillText(txt, 0, 30); //start at x,y = 0,30

    return canvas.toDataURL("image/png");
}

function clearTxtCanvas() {
    var canvas = docEl('txtCanvas');
    var ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function updateDeletionOfRecordsInAppEditor(checkedRecords) {
    var idx;

    checkedRecords.forEach(function (recordKey) {
        idx = appEditor.recordsIndex.map(function (el) { return el.recordKey; }).indexOf(recordKey);

        if (idx !== -1) { //chk which records are null and splice them...
            appEditor.recordsIndex.splice(idx, 1);
        }
    });
}

function getAllChkdForDelete(elId) { //called on "delete record" button FROM MAP
    var tbl = "jb" + elId.substring(2);
    var allInputs = docEl(tbl).querySelectorAll("input.targeted");
    var checkedRecords = [];

    allInputs.forEach(function (el) {
        if (el.checked === true) {
            checkedRecords.push((el.id).substring(2));
        }
    });
    if (!checkedRecords.length) { return; }

    window.mscConfirm({
        title: '',
        subtitle: 'This will permanently delete the selected records from this class! Are you sure?',
        cancelText: 'Exit',
        onOk: function () {
            deleteRecordsViaMap(checkedRecords);
        },
        onCancel: function () {
            return;
        }
    });
}

function getAllChkdForDl(elId) { //called on "download" button
    var tbl = "jb" + elId.substring(2);
    var allInputs = docEl(tbl).querySelectorAll("input.targeted");
    var checkedRecords = [];

    allInputs.forEach(function (el) {
        if (el.checked === true) {
            checkedRecords.push((el.id).substring(2));
        }
    });
    if (!checkedRecords.length) { return; }

    docEl(elId).className += " invisible";

    if (checkedRecords.length === 1) {
        fetchSingleRecordForDownload(checkedRecords[0], elId);
        return;
    }
    fetchSelectedRecordsForDownload(checkedRecords, elId);
}

//NEW RECORDS IN GRADER

function addNewRecordToRecordsIndex(newPostKey, postData) {
    var newObj = {
        stCls: "" + postData.studentData.stCls,
        stId: "" + postData.studentData.stId,
        stNme: "" + postData.studentData.stNme,
        context: "" + postData.context,
        recordKey: "" + newPostKey,
        timeStamp: [postData.timeStamp].slice(0)[0]
    };
    appEditor.recordsIndex.push(newObj); //appEditor.recordsIndex is not sorted
    buildRecordsMap();
}

function commitNewRecord() {
    var allready = saveTempRecord();
    var dataObj;

    if (allready !== true) { return; }

    dataObj = createFinalRecord();
    pushRecordsToDb(dataObj);
}

function dlNewRecordAndSave() {
    var allready = saveTempRecord();
    var dataObj;

    if (allready !== true) { return; }

    dlNewRecord();
    dataObj = createFinalRecord();
    pushRecordsToDb(dataObj);
}

function saveTempRecord() {
    var allLocked = allSectionsAreLocked();

    if (appEditor.grader.tempRecord.ssId === "" || appEditor.grader.tempRecord.ssName === "") {
        displayMsg("t");
        return false;
    }
    if (appEditor.grader.noRubricCommentsOnly === true) {
        if (getGenScoreForNoRubric("gOvrllScr", "gOvrllMax")[0] === "error") { return false; }
    }
    if (allLocked === true) {
        setTempFeedbackComment();
        hideEl("gradeActions");
        return true;
    }
    return false;
}

function allValuesSet(sectionIndex) {
    var complete = true;
    var i;

    for ( i = 0; i < appEditor.grader.tempRecord.scores[sectionIndex].length; i++ ) {
        if(!appEditor.grader.tempRecord.scores[sectionIndex][i].length) {
            complete = false;
            break;
        }
    }
    return complete;
}

function findMaxScore(arrRef) { //find the highest score at any position in the rubric (L to R / R to L, or randomly ordered) -> gives criterias equal weighting within a section
    var highScoreArr = arrRef.map(function(el){ return el.score; }).sort(function(a, b){ return a - b; });
    var highScore = highScoreArr[highScoreArr.length - 1];

    return highScore;
}

function getTempRecordVariables(i, ii) { //required for: making final record for save, viewing rubric preview, pdf
    var criteriaIndex = appEditor.grader.tempRecord.scores[i][ii][1];
    var descIndex = appEditor.grader.tempRecord.scores[i][ii][2];
    var currentValues = {};

    currentValues.sectionIndex = appEditor.grader.tempRecord.scores[i][ii][0];
    currentValues.sectionName = appEditor.grader.rubric[currentValues.sectionIndex].sectionName;
    currentValues.criteria = appEditor.grader.rubric[currentValues.sectionIndex].sectionDef[criteriaIndex].criteriaName;
    currentValues.score = appEditor.grader.rubric[currentValues.sectionIndex].sectionDef[criteriaIndex].criteriaDef[descIndex].score;
    currentValues.maxScore = findMaxScore(appEditor.grader.rubric[currentValues.sectionIndex].sectionDef[criteriaIndex].criteriaDef);
    currentValues.descriptor = appEditor.grader.rubric[currentValues.sectionIndex].sectionDef[criteriaIndex].criteriaDef[descIndex].descriptor;
    return currentValues;
}

function lockThisSection(elId, sectionIndex) {
    setTempRecordComment(elId);
    hideEl("gq" + sectionIndex);
    displayLockedText(sectionIndex, true);
    appEditor.grader.tempRecord.sectionLocked[sectionIndex] = true;
    lockIcon(elId, true);
}

function unlockThisSection(elId, sectionIndex) {
    displayLockedText(sectionIndex, false);
    showEl("gq" + sectionIndex);
    appEditor.grader.tempRecord.sectionLocked[sectionIndex] = false;
    lockIcon(elId, false);
}

function sectionlock(elId) {
    var sectionIndex = Number(elId.substring(2));
    var canLock = allValuesSet(sectionIndex);
    var allSet = false;

    if (appEditor.grader.tempRecord.sectionLocked[sectionIndex] === false) {
        if (canLock === false) {
            displayMsg("u");
        } else {
            lockThisSection(elId, sectionIndex);
            allSet = allSectionsAreLocked();
        }
    } else if (appEditor.grader.tempRecord.sectionLocked[sectionIndex] === true) {
        unlockThisSection(elId, sectionIndex);
    }
    showOrHideSaveBtn(allSet);
}

function allSectionsAreLocked() {
    var allLocked = true;
    var i;

    for ( i = 0; i < appEditor.grader.tempRecord.sectionLocked.length; i++) {
        if (appEditor.grader.tempRecord.sectionLocked[i] === false) {
            allLocked = false;
        }
    }
    return allLocked;
}



function setTempRecordComment(elId) {
    var sectionIndex = Number(elId.substring(2));
    //TODO:
    //var comment = docEl("gk" + sectionIndex).textContent;
    var comment = fixNewlinesInContentEditable("gk" + sectionIndex);

    appEditor.grader.tempRecord.comments[sectionIndex] = comment;
}

function setTempFeedbackComment() {
    //TODO:
    //var fbComment = docEl("gFbWritten").textContent;
    var fbComment = fixNewlinesInContentEditable("gFbWritten");

    appEditor.grader.tempRecord.feedback.written = fbComment;
}

function defineTempRecord() {
    var i,
        ii;

    appEditor.grader.tempRecord.ssId = "";
    appEditor.grader.tempRecord.ssName = "";
    appEditor.grader.tempRecord.class = "";
    appEditor.grader.tempRecord.scores = [];
    appEditor.grader.tempRecord.comments = [];
    appEditor.grader.tempRecord.feedback = {};
    appEditor.grader.tempRecord.feedback.written = "";
    appEditor.grader.tempRecord.sectionLocked = [];
    appEditor.grader.tempRecord.tempCommentElement = "";
    appEditor.grader.tempRecord.tempSelectedSnippets = [];
    appEditor.grader.tempRecord.sectionNames = [];

    for ( i = 0; i < appEditor.grader.rubric.length; i++ ) {
        appEditor.grader.tempRecord.sectionNames.push(appEditor.grader.rubric[i].sectionName);
        appEditor.grader.tempRecord.scores.push([]);
        appEditor.grader.tempRecord.comments.push("");
        appEditor.grader.tempRecord.sectionLocked.push(false);

        var criterias = appEditor.grader.rubric[i].sectionDef.map(function (el) { return el.criteriaName; });

        for ( ii = 0; ii < criterias.length; ii++ ) {
            appEditor.grader.tempRecord.scores[i].push([]);
        }
    }
    delete appEditor.grader.rubricFilter; //stop all references to the setup now:
    delete appEditor.grader.tempRecord.activeSections;
}

function createFinalRecord() {
    var rubricChkd = docEl("gRbChkd").checked;
    var finalRecord = {};
    var recordVal,
        genScore,
        i,
        ii;

    finalRecord.timeStamp = Date.now();
    finalRecord.context = appEditor.grader.tempRecord.context;
    finalRecord.feedback = {};
    finalRecord.feedback.written = appEditor.grader.tempRecord.feedback.written;
    finalRecord.feedback.rubric = appEditor.grader.rubric;
    finalRecord.feedback.rubricChkd = rubricChkd;
    finalRecord.studentData = {};
    finalRecord.studentData.stCls = appEditor.grader.tempRecord.class;
    finalRecord.studentData.stId = appEditor.grader.tempRecord.ssId;
    finalRecord.studentData.stNme = appEditor.grader.tempRecord.ssName;

    if (appEditor.grader.noRubricCommentsOnly === true) {
        finalRecord.noRubric = true;
        finalRecord.noRubricScore = {};
        genScore = getGenScoreForNoRubric("gOvrllScr", "gOvrllMax");
        finalRecord.noRubricScore.scr = genScore[0];
        finalRecord.noRubricScore.max = genScore[1];
    } else {
        finalRecord.comments = [];
        finalRecord.sectionNames = [];
        finalRecord.scores = [];
        finalRecord.sectionNames = appEditor.grader.tempRecord.sectionNames;

        for ( i = 0; i < appEditor.grader.tempRecord.scores.length; i++ ) {
            finalRecord.comments.push(appEditor.grader.tempRecord.comments[i]);
            finalRecord.scores.push([]);

            for ( ii = 0; ii < appEditor.grader.tempRecord.scores[i].length; ii++ ) {
                recordVal = getTempRecordVariables(i, ii);
                finalRecord.scores[i].push([]);
                finalRecord.scores[i][ii].push(recordVal.criteria);
                finalRecord.scores[i][ii].push(recordVal.score);
                finalRecord.scores[i][ii].push(recordVal.maxScore); //@findMaxScore
                finalRecord.scores[i][ii].push(recordVal.descriptor);
            }
        }
    }
    return finalRecord;
}

//STUDENT RECORDS IN GRADER

function allgClasses() {
    var uniqueClasses = appEditor.studentData.map( function(el) { return el.stCls; });

    uniqueClasses = (uniqueValues(uniqueClasses)).sort(function(a, b) { return a - b; });
    return uniqueClasses;
}

function getgCandidatesByClass(str) {
    var stdnts;

    stdnts = appEditor.studentData.filter( function (el) { return el.stCls === str; }).map(function (el) { return [el.stId, el.stNme]; }); //filter returns from (boolean)!
    stdnts.sort( function(a, b){ return a[1].localeCompare(b[1]); });
    return stdnts;
}

//STUDENT RECORDS IN RECORDS

function allClasses() {
    var everyClass = appEditor.recordsIndex.map(function (el) { return el.stCls; }); //get from records ONLY
    var uniqueClasses = (uniqueValues(everyClass)).sort(function (a, b) { return a - b; });

    return uniqueClasses;
}

function getOneSetOfRecords(studentId, studentName, studentClss) {
    var returnArr = appEditor.recordsIndex.filter(function (el) {
        return el.stId === studentId && el.stNme === studentName && el.stCls === studentClss;
    });

    return returnArr || [];
}

function showTheMap(scrollId) {
    hideEl("candidateInfo");
    hideEl("recordsContainer");
    hideEl("ac_re_update");
    hideEl("ac_re_exit");
    hideEl("editRecordActions");
    showEl("mapContainer");

    if (typeof scrollId !== undefined && docEl(scrollId) !== null) {
        docEl(scrollId).scrollIntoView({ behavior: "smooth", block: "center" });
    }
}

function exitUpdateRecords() {
    var scrollId = "jk" + appEditor.appEditRecords.tempStudentRecords[0].recordKey;

    toggleAllRecordChkBoxesOff();
    emptyContent(docEl("recordsContainer"));
    appEditor.appEditRecords.tempStudentRecords = [];
    appEditor.appEditRecords.tempStudent.stId = "";
    appEditor.appEditRecords.tempStudent.stNme = "";
    appEditor.appEditRecords.tempStudent.Clss = "";
    appEditor.editorIsOpen.record = false;
    showTheMap(scrollId);
}

function hideTheMap() {
    hideEl("mapContainer");
    showEl("candidateInfo");
    showEl("recordsContainer");
    showEl("ac_re_update");
    showEl("editRecordActions");
    showEl("ac_re_exit");
}

function selectStudentFromDatasets(elId, bool) { //bool: true for records, false for grader
    var el = docEl(elId);
    var chk = [el.dataset.cls, el.dataset.sid, el.dataset.nme];
    var pass = true;
    var i;

    for (i = 0; i < chk.length; i++) {
        if (chk[i] === undefined || chk[i] === "null" || chk[i] === "") {
            pass = false;
            break;
        }
    }
    if (pass === true) {
        if (bool === true) { setSelectedFromMap(el.dataset.cls, el.dataset.sid, el.dataset.nme); }
        else { setSelectedFromgMap(el.dataset.cls, el.dataset.sid, el.dataset.nme); }
    }
}

function findStudentInRecordsMap(el) {
    var subStr;

    if (el.target !== el.currentTarget) {
        subStr = (el.target.id).substring(0, 2);

        switch (subStr) {
            case "jy": selectStudentFromDatasets(el.target.id, true);
                break;
            case "jq": checkAllByClass(el.target.id);
                break;
            case "jw": checkAllByStudent(el.target.id);
                break;
            case "jh": toggleMapContent(el.target.id);
                break;
            case "jx": getAllChkdForDl(el.target.id);
                break;
            case "jz": getAllChkdForDelete(el.target.id);
                break;
            default: return;
        }
        el.stopPropagation();
    }
}

function checkAllByClass(elId) {
    var tbl = "jb" + elId.substring(2);
    var wholeClass = docEl(tbl).querySelectorAll("span.label.label-md");

    wholeClass.forEach(function (el) {
        checkAllByStudent(el.id);
    });
}

function toggleAllRecordChkBoxesOff() { //when exiting appEditor.appEditRecords
    var container = docEl("recordsMap");
    var allRecords = container.querySelectorAll("input.targeted");

    allRecords.forEach(function (record) {
        docEl(record.id).dataset.slct = "none";
        docEl(record.id).checked = false;
    });
}

function checkAllByStudent(elId) {
    var toggle = docEl(elId).dataset.slct; //data-slct = "all" or "none" controls action
    var tr = docEl(elId).parentElement.parentElement;
    var records;

    if (tr == undefined || tr === null) { return; }

    records = tr.querySelectorAll("input.targeted");
    records.forEach(function (record) {
        if (toggle === "all") {
            docEl(elId).dataset.slct = "none";

            if (docEl(record.id).checked !== true) {
                docEl(record.id).checked = true;
            }
        }
        if (toggle === "none") {
            docEl(elId).dataset.slct = "all";

            if (docEl(record.id).checked !== false) {
                docEl(record.id).checked = false;
            }
        }
    });
}

function toggleClassShow(clssNum) {
    docEl("jh" + clssNum).className = docEl("jh" + clssNum).className.replace(/(?:^|\s)collpsd(?!\S)/g, '');
    showEl("jm" + clssNum);
    showEl("jq" + clssNum);
    showEl("jz" + clssNum);
    showEl("jx" + clssNum);
}

function toggleClassHide(clssNum) {
    docEl("jh" + clssNum).className += " collpsd";
    hideEl("jm" + clssNum);
    hideEl("jq" + clssNum);
    hideEl("jz" + clssNum);
    hideEl("jx" + clssNum);
}

function toggleMapContent(elId) {
    var clssNum = elId.substring(2);
    var isCollapsed = docEl("jm" + clssNum).classList.contains("nodisplay");

    if (isCollapsed) {
        toggleClassShow(clssNum);
    } else {
        toggleClassHide(clssNum);
    }
}

function setSelectedFromMap(cls, sid, nme) { //el.dataset.cls, el.dataset.sid, el.dataset.nme
    var thisClass = docEl("thisClass");
    var thisStudent = docEl("thisStudent");

    appEditor.appEditRecords.tempStudent.stId = sid;
    appEditor.appEditRecords.tempStudent.stNme = nme;
    appEditor.appEditRecords.tempStudent.Clss = cls;
    thisClass.value = appEditor.appEditRecords.tempStudent.Clss;
    thisStudent.textContent = appEditor.appEditRecords.tempStudent.stId + " " + appEditor.appEditRecords.tempStudent.stNme;
    hideTheMap();
    buildTempRecords();
}

function getCandidatesByClass(str) {
    var stdnts = appEditor.recordsIndex.filter(function (el) {
        return el.stCls === str;
    }).map(function (elem) {
        return [elem.stId, elem.stNme];
    });

    stdnts.sort(function (a, b) {
        return a[1].localeCompare(b[1]);
    });
    stdnts = uniqueNestedArrs(stdnts, 0);
    return stdnts;
}

//EDITING RECORDS

//IMPORTANT: all names are from records and NOT from studentData

function flattenRecords(indexObj) {
    var keys,
        newIdxRecord;

    if (indexObj === null || isObjEmpty(indexObj)) { return false; }

    keys = Object.keys(indexObj);
    keys.forEach(function (el) {
        newIdxRecord = {};
        newIdxRecord.recordKey = el;
        newIdxRecord.context = indexObj[el].context;
        newIdxRecord.stCls = indexObj[el].studentData.stCls;
        newIdxRecord.stId = indexObj[el].studentData.stId;
        newIdxRecord.stNme = indexObj[el].studentData.stNme;
        newIdxRecord.timeStamp = indexObj[el].timeStamp;
        appEditor.recordsIndex.push(newIdxRecord);
    });
    return true;
}

function displayRecords() {
    emptyContent(docEl("recordsContainer"));
    buildRecordsMap();
    showTheMap();

    if (appEditor.recordsIndex.length) { docEl("recordsHeader").textContent = ""; }
    else { docEl("recordsHeader").textContent = "No records!"; }
    showEl("recordsContainer");
}

function buildTempRecords() { //referring to the student loaded into: appEditor.appEditRecords.tempStudent...
    var count = 0;
    var uid = firebase.auth().currentUser.uid;
    var recordsExist,
        len,
        elsChkd;

    if (appEditor.appEditRecords.tempStudent.stId !== "" && appEditor.appEditRecords.tempStudent.stNme !== "" && appEditor.appEditRecords.tempStudent.Clss !== "") {
        recordsExist = getOneSetOfRecords(appEditor.appEditRecords.tempStudent.stId, appEditor.appEditRecords.tempStudent.stNme, appEditor.appEditRecords.tempStudent.Clss);

        if (!recordsExist.length) {
            docEl("recordsContainer").textContent = "No records exist for this student!";
            hideEl("ac_re_update");
            hideEl("ac_re_exit");
            buildRecordsMap();
            return;
        }
        appEditor.appEditRecords.tempStudentRecords = []; //must be kept clear
        elsChkd = recordsExist.filter(function (el) {
            return docEl("jk" + el.recordKey).checked === true;
        });
        len = elsChkd.length;

        if (len === 0) {
            noRecordsSelected();
            return;
        }
        elsChkd.forEach(function (el) {
            firebase.database().ref('assessments/' + uid + '/records/' + el.recordKey).once('value').then(function (snapshot) {
                var fullRecord = snapshot.val();

                if (fullRecord !== null) {
                    fullRecord.recordKey = el.recordKey; //add recordKey here so we can update changes by key directly
                    appEditor.appEditRecords.tempStudentRecords.push(fullRecord);
                }
                count++;

                if (count === len) {
                    loadSelectedStudentRecords();
                }
            }, function (e) {
                chkPermission(e);
            });
        });
    }
}

function noRecordsSelected() {
    showTheMap();
    displayMsg("p");
}

function loadSelectedStudentRecords() {
    var len = appEditor.appEditRecords.tempStudentRecords.length;
    var i;

    if (!len) { return; }

    emptyContent(docEl("recordsContainer"));
    showEl("candidateInfo");

    for (i = 0; i < len; i++) {
        populateFinalRecordEl(i);
    }
    appEditor.editorIsOpen.record = true;
}

function populateFinalRecordEl(recordIndex) { //loads ONE full record
    var stdntRcrd = appEditor.appEditRecords.tempStudentRecords[recordIndex];
    var allSectionsOfRecord,
        len,
        sectionName,
        i;

    if (stdntRcrd.hasOwnProperty("noRubric") && stdntRcrd.noRubric === true) {
        createFinalRecordElForNoRubric(recordIndex); //one record {} shell
        return;
    }

    createFinalRecordEl(recordIndex); //one record {} shell
    allSectionsOfRecord = stdntRcrd.sectionNames;
    len = allSectionsOfRecord.length;

    for (i = 0; i < len; i++) {
        sectionName = allSectionsOfRecord[i];
        createFinalRecordSectionEl(recordIndex, sectionName, i); //each section of one record
        createFinalRecordCriteriasEl(recordIndex, i); //all criterias within each section of one record
    }
}

function setRecordFeedbck(recordIndex) {
    var targetWritten = docEl("opt1_" + recordIndex);

    targetWritten.textContent = appEditor.appEditRecords.tempStudentRecords[recordIndex].feedback.written;
}

function setRecordRubric(recordIndex) {
    var stdntRcrd = appEditor.appEditRecords.tempStudentRecords[recordIndex];
    var container = docEl("frrA" + recordIndex);
    var frag = document.createDocumentFragment();
    var fbRubric,
        numOfTables,
        numOfRows,
        numOfCells,
        i,
        ii,
        iii;

    emptyContent(container);

    if (stdntRcrd.hasOwnProperty("noRubric") && stdntRcrd.noRubric === true) {
        return;
    }
    fbRubric = stdntRcrd.feedback.rubric;
    numOfTables = fbRubric.length;

    for (i = 0; i < numOfTables; i++) {
        var newTable = document.createElement("table");
        var newThead = document.createElement("thead");
        var newHeadTr = document.createElement("tr");
        var newTbody = document.createElement("tbody");
        var isRowStart;
        var isFirstRow;
        var isColStart;

        newTable.className = "table table-responsive table-striped table-bordered table-condensed";
        numOfRows = fbRubric[i].sectionDef.length;
        isRowStart = true;
        isFirstRow = true;

        for (ii = 0; ii < numOfRows; ii++) { //header row
            numOfCells = fbRubric[i].sectionDef[ii].criteriaDef.length;

            for (iii = 0; iii < numOfCells; iii++) {
                var newTh = document.createElement("th");

                if (isFirstRow === true) {//define the first row
                    if (isRowStart === true) {
                        var newCol1Th = document.createElement("th");

                        newCol1Th.textContent = fbRubric[i].sectionName;
                        newHeadTr.appendChild(newCol1Th);
                        isRowStart = false;
                    }
                    newTh.textContent = fbRubric[i].sectionDef[ii].criteriaDef[iii].score;
                    newHeadTr.appendChild(newTh);
                }
            }
            isFirstRow = false;
        }
        newThead.appendChild(newHeadTr);

        for (ii = 0; ii < numOfRows; ii++) { //body
            var newTr = document.createElement("tr");

            numOfCells = fbRubric[i].sectionDef[ii].criteriaDef.length;
            isColStart = true;

            for (iii = 0; iii < numOfCells; iii++) {
                var newTd = document.createElement("td");

                if (isColStart === true) { //define the first cell (criteria name)
                    var newCol1 = document.createElement("td");

                    newCol1.textContent = fbRubric[i].sectionDef[ii].criteriaName;
                    newTr.appendChild(newCol1);
                    isColStart = false;
                }
                newTd.textContent = fbRubric[i].sectionDef[ii].criteriaDef[iii].descriptor;
                newTr.appendChild(newTd);
            }
            newTbody.appendChild(newTr);
        }
        newTable.appendChild(newThead);
        newTable.appendChild(newTbody);
        frag.appendChild(newTable);
    }
    container.appendChild(frag);
}

function updateDescriptorOnScoreChange(criteriaId) { //"ff" + recordIndex + "-" + sectionIndex + "-" + criteriaIdx + "-1"
    var idx = docEl(criteriaId).selectedIndex;
    var descr,
        idxArr;

    if (idx == undefined) { return; }

    idxArr = buildTokens(criteriaId.substring(2), "-");
    descr = appEditor.appEditRecords.tempStudentRecords[idxArr[0]].feedback.rubric[idxArr[1]].sectionDef[idxArr[2]].criteriaDef[idx].descriptor;
    docEl("ff" + idxArr[0] + "-" + idxArr[1] + "-" + idxArr[2] + "-3").textContent = descr;
}

function checkForNullSectionFields(recordIndex, sectionIndex) {
    var sectionId = "opt4_" + recordIndex + "_" + sectionIndex || "";
    var chkSection = "ok";

    if (docEl(sectionId).value === "") { chkSection = "Please check the names of each section."; }
    return chkSection;
}

function chkForDupSectionNames(savedArr, sectionIds) {
    var chkSection = "ok";

    sectionIds = uniqueValues(sectionIds);

    if (savedArr.length !== sectionIds.length) { chkSection = "Please check that the names of each section are unique."; }
    return chkSection;
}

function chkAllRecordsBeforeUpdate() { //called on "save" button
    var recordLen,
        el,
        sectionChk,
        criteriaChk,
        contextChk,
        genScoreChk,
        sectionLen,
        criteriaLen,
        sectionIds,
        i,
        ii,
        iii;

    if (!appEditor.appEditRecords.tempStudentRecords.length) { return; }
    if (docEl("thisClass").value === "") {
        displayMsg("q");
        return;
    }
    recordLen = appEditor.appEditRecords.tempStudentRecords.length;
    sectionChk = "ok";
    criteriaChk = "ok";
    contextChk = "ok";
    genScoreChk = "ok";

    //check for empty or invalid fields on the UI...
    //MUST SKIP sections that have prop: "null_marked_for_deletion" in data, or will hit el.s that don't exist in the DOM
    for (i = 0; i < recordLen; i++) {
        el = appEditor.appEditRecords.tempStudentRecords[i];

        if (el.hasOwnProperty("null_marked_for_deletion")) { continue; }

        if (el.hasOwnProperty("noRubric") && el.noRubric === true) {
            genScoreChk = getGenScoreForNoRubric("ts" + i, "tm" + i)[0];
            if (genScoreChk === "error") {
                break;
            } else {
                genScoreChk = "ok";
                continue;
            }
        }
        if (docEl("fc" + i).value === "") {
            contextChk = "All grading contexts MUST be defined!";
            break;
        }
        sectionLen = el.scores.length;
        sectionIds = []; //keep clear for each record

        for (ii = 0; ii < sectionLen; ii++) {
            sectionChk = checkForNullSectionFields(i, ii);
            if (sectionChk !== "ok") {
                break;
            }
            criteriaLen = el.scores[ii].length;

            for (iii = 0; iii < criteriaLen; iii++) {
                criteriaChk = checkForBadCriteriaFields(i, ii, iii);
                if (criteriaChk !== "ok") {
                    break;
                }
            }
            sectionIds.push(docEl("opt4_" + i + "_" + ii).value || "");
        }
        sectionChk = chkForDupSectionNames(el.sectionNames, sectionIds);

        if (sectionChk !== "ok") {
            break;
        }
    }
    if (contextChk === "ok" && sectionChk === "ok" && criteriaChk === "ok" && genScoreChk === "ok") {
        updateRecords();
        return;
    }
    if (contextChk !== "ok") {
        displayMsg("c", contextChk);
        return;
    }
    if (sectionChk !== "ok") {
        displayMsg("c", sectionChk);
        return;
    }
    if (criteriaChk !== "ok") {
        displayMsg("c", criteriaChk);
        return;
    }
}

function checkForBadCriteriaFields(recordIndex, sectionIndex, criteriaIndex) {
    var criteriaId = "ff" + recordIndex + "-" + sectionIndex + "-" + criteriaIndex + "-";
    var scoreVal = docEl(criteriaId + "1").options[docEl(criteriaId + "1").selectedIndex].value;
    var sendAlert = "ok";

    if (numsOnly(scoreVal) === "") { sendAlert = "Please check all scores."; }
    return sendAlert;
}

function createIndexObjForDb(recordObj) {  //n.b.: no recordKey prop!
    var recordindexObj = { context: recordObj.context, studentData: recordObj.studentData, timeStamp: recordObj.timeStamp };

    return recordindexObj;
}

function removeRecordKeyFromObjForDb(recordObj) {
    var copyObj = {};

    copyObj.context = recordObj.context;
    copyObj.feedback = recordObj.feedback;
    copyObj.studentData = recordObj.studentData;
    copyObj.timeStamp = recordObj.timeStamp;

    if (recordObj.hasOwnProperty("noRubric") && recordObj.noRubric === true) {
        copyObj.noRubric = true;
        copyObj.noRubricScore = recordObj.noRubricScore;
    } else {
        copyObj.comments = recordObj.comments;
        copyObj.scores = recordObj.scores;
        copyObj.sectionNames = recordObj.sectionNames;
    }
    return copyObj;
}

function saveUpdateRecordsInAppEditor() {
    var idx,
        obj,
        objIdx,
        i;

    for (i = appEditor.appEditRecords.tempStudentRecords.length - 1; i >= 0; i--) {
        obj = appEditor.appEditRecords.tempStudentRecords[i];
        idx = appEditor.recordsIndex.map(function (el) { return el.recordKey; }).indexOf(obj.recordKey);

        if (idx !== -1) { //chk which records are null and splice them...
            if (obj.hasOwnProperty("null_marked_for_deletion")) {
                if (obj.null_marked_for_deletion === true) {
                    appEditor.recordsIndex.splice(idx, 1);
                }
            } else {
                objIdx = {
                    stCls: obj.studentData.stCls,
                    stId: obj.studentData.stId,
                    stNme: obj.studentData.stNme,
                    context: obj.context,
                    recordKey: obj.recordKey,
                    timeStamp: obj.timeStamp
                };
                appEditor.recordsIndex[idx] = objIdx;
            }
        }
    }
}

function updateRecords() {
    var recordLen = appEditor.appEditRecords.tempStudentRecords.length;
    var sectionLen,
        criteriaLen,
        recordObj,
        genScore,
        i,
        ii,
        iii;

    if (recordLen === 0) { return; }

    for (i = 0; i < recordLen; i++) {
        recordObj = appEditor.appEditRecords.tempStudentRecords[i];

        if (recordObj.hasOwnProperty("null_marked_for_deletion")) { continue; } //we cant delete individual records marked for deletion...we need to know if this prop exists to update the database with a null value
        if (docEl("thisClass").value !== appEditor.appEditRecords.tempStudent.Clss) { recordObj.studentData.stCls = docEl("thisClass").value; }

        recordObj.context = docEl("fc" + i).value;
        //TODO:
        //recordObj.feedback.written = docEl("opt1_" + i).textContent;
        recordObj.feedback.written = fixNewlinesInContentEditable("opt1_" + i);

        if (recordObj.hasOwnProperty("noRubric") && recordObj.noRubric === true) {
            recordObj.noRubric = true;
            recordObj.noRubricScore = {};
            genScore = getGenScoreForNoRubric("ts" + i, "tm" + i);
            recordObj.noRubricScore.scr = genScore[0];
            recordObj.noRubricScore.max = genScore[1];
            recordObj.feedback.rubricChkd = false;
            continue;
        }
        recordObj.feedback.rubricChkd = docEl("opt2_" + i).checked;
        sectionLen = recordObj.scores.length;

        for (ii = 0; ii < sectionLen; ii++) {
            //TODO:
            //recordObj.comments[ii] = docEl("opt3_" + i + "_" + ii).textContent;
            recordObj.comments[ii] = fixNewlinesInContentEditable("opt3_" + i + "_" + ii);
            recordObj.sectionNames[ii] = docEl("opt4_" + i + "_" + ii).value;
            criteriaLen = recordObj.scores[ii].length;

            for (iii = 0; iii < criteriaLen; iii++) {
                var criteriaId = "ff" + i + "-" + ii + "-" + iii + "-";
                recordObj.scores[ii][iii][1] = docEl(criteriaId + "1").options[docEl(criteriaId + "1").selectedIndex].value;
                recordObj.scores[ii][iii][3] = docEl(criteriaId + "3").textContent;
            }
        }
    }
    saveUpdatedRecords();
}

function markRecordForDeletion(sTokens) { //"fh0" is the id of the record!
    var el = docEl("fh" + sTokens[0]);
    var recordObj = appEditor.appEditRecords.tempStudentRecords[sTokens[0]];
    var dateTime = new Date(recordObj.timeStamp).toLocaleString();

    recordObj.null_marked_for_deletion = true;
    emptyContent(el);
    el.className += " delPending";
    el.textContent = recordObj.context + " " + dateTime;
}

function deleteRecordIsClicked(elId) {
    var sTokens = buildTokens(elId.substring(2), "-"); //"fx0-0"

    if (sTokens.length === 2 && sTokens[0] === 0) {
        markRecordForDeletion(sTokens);
    }
}

function switchObjForTokens(elId) {
    var sbStr = elId.substring(0, 2);

    switch (sbStr) {
        case "fx": deleteRecordIsClicked(elId);
            break;
        case "fv": showRecordRubricSection(elId);
            break;
        case "fw": hideRecordRubricSection(elId);
            break;
        default: return;
    }
}

function hideRecordRubricSection(elId) {
    var idx = elId.substring(2);

    showEl("fh" + idx);
    hideEl("fq" + idx);
}

function showRecordRubricSection(elId) {
    var idx = elId.substring(2);

    hideEl("fh" + idx);
    showEl("fq" + idx);
}

function setLabelIndex(elId) {
    if (elId.substring(0, 5) === "opt5_") {
        appEditor.appEditRecords.labelIndex = Number(elId.substring(5));
    }
}

function identifySelectopt(el) {
    if (el.target !== el.currentTarget) {
        if (el.target.nodeName === "SELECT") {
            //onchange Score dropdown: update the relevant descriptor from the accompanying rubric
            updateDescriptorOnScoreChange(el.target.id);
        }
        el.stopPropagation();
    }
}

function identifyEditRecordEl(el) {
    if (el.target !== el.currentTarget) {
        if (el.target.nodeName !== "SELECT") {
            if (el.target.nodeName === "LABEL") {
                setLabelIndex(el.target.id);
            } else {
                switchObjForTokens(el.target.id);
            }
        }
        el.stopPropagation();
    }
}

//SNIPPETS

function buildTableForSnippets(bool) { //if true -> hardreload, if false -> update tags only (e.g. when rubrics are changed)
    var available = appEditor.snippets.map(function (el) { return el.snippetRubric; });
    var snippetsArr,
        i,
        ii;

    if (!available.length) {
        addNewSnippet();
        return;
    }
    for (i = 0; i < available.length; i++) {
        snippetsArr = appEditor.snippets[i].snippetDef;

        for (ii = 0; ii < snippetsArr.length; ii++) {
            if (bool === true) { createSnippetEl(i, ii, snippetsArr[ii].snippet); }
            tagSnippetRubrics(i, ii);
            tagSnippetSections(i, ii);
        }
    }
}



function tagSnippetRubrics(objIndex, snptIndex) {
    var targetRubricSelect = docEl("iu" + objIndex + "-" + snptIndex);
    var frag = document.createDocumentFragment();
    var allRubricKeys = Object.keys(appEditor.rubricsIndex);
    var allRubricTags = allRubricKeys.map(function (el) { return appEditor.rubricsIndex[el].rubricName; }); //get all avaiable rubric names
    var targetIndex,
        i;

    allRubricTags.unshift("any");
    allRubricTags = uniqueValues(allRubricTags);
    targetIndex = allRubricTags.indexOf(appEditor.snippets[objIndex].snippetRubric);

    if (targetIndex === -1) {
        appEditor.snippets[objIndex].snippetRubric = "any";
        targetIndex = 0;
    }

    for (i = 0; i < allRubricTags.length; i++) {
        var newOpt = document.createElement("option");

        newOpt.value = allRubricTags[i];
        newOpt.textContent = allRubricTags[i];
        frag.appendChild(newOpt);
    }
    emptyContent(targetRubricSelect);
    targetRubricSelect.appendChild(frag);
    targetRubricSelect.options[targetIndex].setAttribute("selected", true);
}

function tagSnippetSections(objIndex, snptIndex) {
    var targetSectionSelect = docEl("ia" + objIndex + "-" + snptIndex);
    var frag = document.createDocumentFragment();
    var allSectionTags = [];
    var targetIndex = -1;
    var i;
    var allRubricKeys = Object.keys(appEditor.rubricsIndex);
    var allRubricTags = allRubricKeys.map(function (el) { return appEditor.rubricsIndex[el].rubricName; }); //get all avaiable rubric names
    var rubricIndex = allRubricTags.indexOf(appEditor.snippets[objIndex].snippetRubric);

    if (rubricIndex !== -1) { allSectionTags = appEditor.rubricsIndex[allRubricKeys[rubricIndex]].sectionNames; }
    allSectionTags.unshift("any");
    allSectionTags = uniqueValues(allSectionTags);
    targetIndex = allSectionTags.indexOf(appEditor.snippets[objIndex].snippetDef[snptIndex].section);

    if (targetIndex === -1) {
        appEditor.snippets[objIndex].snippetDef[snptIndex].section = "any";
        targetIndex = 0;
    }
    for (i = 0; i < allSectionTags.length; i++) {
        var newOpt = document.createElement("option");

        newOpt.value = allSectionTags[i];
        newOpt.textContent = allSectionTags[i];
        frag.appendChild(newOpt);
    }
    emptyContent(targetSectionSelect);
    targetSectionSelect.appendChild(frag);
    targetSectionSelect.options[targetIndex].setAttribute("selected", true);
}

function getIndexOfSnippetObjFromRubricName(rubricName) {
    var index = -1;
    var len = appEditor.snippets.length;
    var i;

    for (i = 0; i < len; i++) {
        if (appEditor.snippets[i].snippetRubric === rubricName) {
            index = i;
            break;
        }
    }
    return index;
}

function addNewSnippet() {//pushes an empty element onto the "any" array and displays a new empty contentEditable
    var newEl = {};
    var relevantObjIndex = getIndexOfSnippetObjFromRubricName("any");
    var newIndex,
        temp;

    newEl.section = "any";
    newEl.snippet = ""; //null_placeholder_for_new_snippet

    if (relevantObjIndex === -1) {
        temp = { "snippetRubric": "any", "snippetDef": [] };
        appEditor.snippets.push(temp);
        relevantObjIndex = appEditor.snippets.length - 1;
    }
    appEditor.snippets[relevantObjIndex].snippetDef.push(newEl);
    newIndex = appEditor.snippets[relevantObjIndex].snippetDef.length - 1;
    createSnippetEl(relevantObjIndex, newIndex, ""); //new empty element
    tagSnippetRubrics(relevantObjIndex, newIndex);
    tagSnippetSections(relevantObjIndex, newIndex);
}

function fireUpdateSingleTagSnippetSection(elId) { //"iu" + objIndex + "-" + snptIndex
    var idxArr = buildTokens(elId.substring(2), "-");

    updateSingleTagSnippetSection(elId, idxArr);
}

function updateSingleTagSnippetSection(elId, idxArr) {
    var objIndex = idxArr[0];
    var snptIndex = idxArr[1];
    var newRef = docEl(elId).options[docEl(elId).selectedIndex].value;
    var targetSectionSelect = docEl("ia" + objIndex + "-" + snptIndex);
    var frag = document.createDocumentFragment();
    var allSectionTags = [];
    var targetIndex = -1;
    var i;
    var allRubricKeys = Object.keys(appEditor.rubricsIndex);
    var allRubricTags = allRubricKeys.map(function (el) { return appEditor.rubricsIndex[el].rubricName; }); //get all avaiable rubric names
    var rubricIndex = allRubricTags.indexOf(newRef);
    //get all section names from the associated rubric...resolves only when changes are SAVED
    if (rubricIndex !== -1) {
        allSectionTags = appEditor.rubricsIndex[allRubricKeys[rubricIndex]].sectionNames;
    }
    allSectionTags.unshift("any");
    allSectionTags = uniqueValues(allSectionTags);
    targetIndex = allSectionTags.indexOf(appEditor.snippets[objIndex].snippetDef[snptIndex].section);

    if (targetIndex === -1) {
        appEditor.snippets[objIndex].snippetDef[snptIndex].section = "any";
        targetIndex = 0;
    }

    for (i = 0; i < allSectionTags.length; i++) {
        var newOpt = document.createElement("option");

        newOpt.value = allSectionTags[i];
        newOpt.textContent = allSectionTags[i];
        frag.appendChild(newOpt);
    }
    emptyContent(targetSectionSelect);
    targetSectionSelect.appendChild(frag);
    targetSectionSelect.options[targetIndex].setAttribute("selected", true);
}

function updateSnippetRubricTags() { //when any rubric is updated, rubric and section tags on snippets need to be updated too
    buildTableForSnippets(false);
}

function removeOneSnippet(elId) {
    var indexes = elId.substring(2);
    //hide the snippet when "X" is clicked, clear the content and hide the tr
    hideEl("ii" + indexes);
    docEl("ix" + indexes).textContent = "";
}

function initSnippets() {
    if (appEditor.snippets.length) {
        appEditor.snptSNAPSHOT = JSON.stringify(appEditor.snippets);
    } else {
        appEditor.snptSNAPSHOT = "";
    }
    buildTableForSnippets(true);
}

function coldExitSnippets() {
    var snippetContent,
        i,
        ii;

    if (appEditor.hasOwnProperty("snptSNAPSHOT")) {
        if (appEditor.snptSNAPSHOT !== "") {
            appEditor.snippets = JSON.parse(appEditor.snptSNAPSHOT);
        }
    }
    if (appEditor.snippets.length) {
        for (i = 0; i < appEditor.snippets.length; i++) {
            for (ii = appEditor.snippets[i].snippetDef.length - 1; ii >= 0; ii--) {
                snippetContent = appEditor.snippets[i].snippetDef[ii].snippet;

                if (snippetContent === "" || snippetContent === "null_placeholder_for_new_snippet") {
                    appEditor.snippets[i].snippetDef.splice(ii, 1);
                }
            }
        }
        for (i = appEditor.snippets.length - 1; i >= 0; i--) {
            if (!appEditor.snippets[i].snippetDef.length) {
                appEditor.snippets.splice(i, 1);
            }
        }
    }
    exitSnippets();
}

function exitSnippets() {
    emptyContent(docEl("snptsTbd"));
    initSnippets();
}

function saveChangesToSnippets() {
    if (appEditor.snippets.length) {
        var isUpdated = updateAllSnippetData();

        if (isUpdated === true) { saveSnippetData(); }
    }
}

function updateAllSnippetData() {
    var tempArr = [];
    var targetNodes = docEl("snptsTbd").querySelectorAll("tr");
    var newSnippetDef,
        rubricsArr,
        elId,
        tempObj,
        newSnippetObj,
        idx,
        i;

    disableEl("snippetsContainer");
    appEditor.snippets = [];
    targetNodes.forEach(function (tr) {
        elId = (tr.id).substring(2);
        tempObj = {};
        tempObj.rubric = docEl("iu" + elId).options[docEl("iu" + elId).selectedIndex].value;
        tempObj.section = docEl("ia" + elId).options[docEl("ia" + elId).selectedIndex].value;
        //TODO:
        //tempObj.content = docEl("ix" + elId).textContent;
        tempObj.content = fixNewlinesInContentEditable("ix" + elId);

        if (tempObj.content !== "" /* tempObj.content !=="null_placeholder_for_new_snippet"*/) { tempArr.push(tempObj); }
    });

    if (!tempArr.length) {
        enableEl("snippetsContainer");
        return true;
    }
    rubricsArr = tempArr.map(function (el) { return el.rubric; });
    rubricsArr = uniqueValues(rubricsArr);

    for (i = 0; i < rubricsArr.length; i++) {
        newSnippetObj = {};
        newSnippetObj.snippetRubric = rubricsArr[i];
        newSnippetObj.snippetDef = [];
        appEditor.snippets.push(newSnippetObj);
    }
    for (i = 0; i < tempArr.length; i++) {
        idx = getIndexOfSnippetObjFromRubricName(tempArr[i].rubric);
        newSnippetDef = {};
        newSnippetDef.section = tempArr[i].section;
        newSnippetDef.snippet = tempArr[i].content;
        appEditor.snippets[idx].snippetDef.push(newSnippetDef);
    }
    enableEl("snippetsContainer");
    return true;
}

function identifySnippet(el) {
    var elId;

    if (el.target !== el.currentTarget && el.target.nodeName !== "LABEL") { //because fires twice: once for label, and once for input
        elId = el.target.id;

        if (elId.substring(0, 2) === "ie") { removeOneSnippet(elId); }
    }
    el.stopPropagation();
}

//USING SNIPPETS IN GRADER

function viewSnippets(elId) {
    var index;

    if (!appEditor.grader.snippets.length || (appEditor.grader.snippets.length === 1 && appEditor.grader.snippets[0].snippet === "")) { //placeholder obj.
        displayMsg("v");
        return;
    }
    if (elId !== "gFbWritten") {
        index = (elId).substring(2);
        appEditor.grader.tempRecord.tempCommentElement = "gk" + index;
    } else {
        appEditor.grader.tempRecord.tempCommentElement = elId;
    }
    hideEl("userInput");
    showEl("viewgSnppts");
}

function viewSnippetsForTextA() { //textApaste
    viewSnippets("gFbWritten");
}

function pasteSnippetToDiv(str) {
    var targetEl = appEditor.grader.tempRecord.tempCommentElement;

    if (targetEl !== "") { docEl(targetEl).textContent += " " + str; }
}

function pasteSnippetOnSave(index) {
    var sourceEl = docEl("gx" + index);
    var newText = sourceEl.textContent;

    pasteSnippetToDiv(newText); //adds selected as textContent (target Element is kept in: appEditor.grader.tempRecord.tempCommentElement)
}

//each time a snippet chkbx is checked or unchecked, appEditor.grader.tempRecord.tempSelectedSnippets needs to be updated
//@ identifyGradingSnippet(el)
function isChkdOrNot(elId) {
    var state = docEl(elId).checked;
    var targetIndex = elId.substring(2);  //the index NUMBER as a string
    var removeEl,
        targetId,
        i;

    if (state === true) {
        appEditor.grader.tempRecord.tempSelectedSnippets.push(targetIndex);
    } else {
        removeEl = appEditor.grader.tempRecord.tempSelectedSnippets.indexOf(targetIndex);
        if (removeEl !== - 1) {
            appEditor.grader.tempRecord.tempSelectedSnippets.splice(removeEl, 1);
        }
    }
    for (i = 0; i < appEditor.grader.snippets.length; i++) { //clear all helper numbers
        targetId = "gn" + i;
        docEl(targetId).textContent = "";
    }
    for (i = 0; i < appEditor.grader.tempRecord.tempSelectedSnippets.length; i++) { //update all helper numbers on the UI (next to each chkbx)
        targetId = "gn" + appEditor.grader.tempRecord.tempSelectedSnippets[i]; //the target helper number div
        docEl(targetId).textContent = (i + 1);
    }
}

function reloadSnippets(bool) {
    var i;

    if (bool === true) { //performed only when the save/close button is hit
        //this block loops through the id.s and adds the corresponding snippets to textContent IN THAT ORDER
        var allSectionTags = appEditor.grader.rubric.map(function (el) { return el.sectionName; });
        var targetIndexes = appEditor.grader.tempRecord.tempSelectedSnippets; //["0", "4", "2"...]
        var snipptsToAdd = targetIndexes.length;

        if (allSectionTags.indexOf("any") === -1) {
            allSectionTags.unshift("any");
        }
        for (i = 0; i < snipptsToAdd; i++) {
            pasteSnippetOnSave(targetIndexes[i]);
        }
    }
    setUpToReloadSnippets();
}

function setUpToReloadSnippets() {
    var i;

    appEditor.grader.snippets = appEditor.grader.snippets.sort(function (a, b) { //reads better alphabetically...
        return a.snippet.localeCompare(b.snippet);
    });
    emptyContent(docEl("snpptgContainer"));

    for (i = 0; i < appEditor.grader.snippets.length; i++) {
        createGradingSnippetEl(i, appEditor.grader.snippets[i].snippet);
    }
}

function findIndexInSnippets(rubricName) {
    var index = -1;
    var i;

    if (appEditor.grader.snippets.length) {
        for (i = 0; i < appEditor.grader.snippets.length; i++) {
            if (appEditor.grader.snippets[i].snippetRubric === rubricName) {
                index = i;
                break;
            }
        }
    }
    return index;
}

function startSnippets() {
    var relevant;

    appEditor.grader.snippets = appEditor.snippets.slice(0);

    if (appEditor.grader.noRubricCommentsOnly === true) {
        reloadSnippets(false);
        return;
    }
    if (appEditor.grader.snippets.length) {
        relevant = filterSnippets();
        appEditor.grader.snippets = relevant;
        reloadSnippets(false);
    }
}

function filterSnippets() { //call only AFTER rubric has been defined...@ letsGetStarted()
    var refIndex = findIndexInSnippets(appEditor.grader.tempRecord.rubricRef);
    var anyIndex = findIndexInSnippets("any");
    var snippetData = [];
    var relevant;
    var filtered;
    var anySnippet;
    var result;
    var i;

    //    if (refIndex !== -1 && anyIndex !== -1)  {  return; }
    if (refIndex !== -1) {
        if (anyIndex !== -1) { return; } //appEditor.grader.snippets is already either an empty array (by default) or an array of obj.s

        for (i = appEditor.grader.snippets[refIndex].snippetDef.length - 1; i >= 0; i--) {
            snippetData.push(appEditor.grader.snippets[refIndex].snippetDef[i]);
        }
    }
    if (anyIndex !== -1) {
        for (i = appEditor.grader.snippets[anyIndex].snippetDef.length - 1; i >= 0; i--) {
            snippetData.unshift(appEditor.grader.snippets[anyIndex].snippetDef[i]);
        }
    }

    relevant = appEditor.grader.rubric.map(function (el) { return el.sectionName; });
    filtered = relevant.map(function (elem) {
        return snippetData.filter(function (el, index) {
            return snippetData[index].section.indexOf(elem) !== -1;
        });
    }).reduce(function (prev, current) {
        return prev.concat(current);
    });
    anySnippet = snippetData.filter(function (el) {
        return el.section === "any";
    });
    result = filtered.concat(anySnippet);

    return result;
}

function createTagsForSnippets(snippetIndex) {
    var targetSpan = docEl("gt" + snippetIndex);
    var allSectionTags = ["any"];
    var sectionsRef = appEditor.grader.tempRecord.sectionNames;
    var refLen = sectionsRef.length;
    var targetIndex,
        i;

    for (i = 0; i < refLen; i++) {
        allSectionTags.push(sectionsRef[i]);
    }
    targetIndex = allSectionTags.indexOf(appEditor.grader.snippets[snippetIndex].section);

    if (targetIndex !== -1) {
        targetSpan.textContent = allSectionTags[targetIndex];
    }
}

function exitGradingSnippets() {
    gradingSnippetsExit(false);
}

function pasteAndCloseSnippets() {
    gradingSnippetsExit(true);
}

//STUDENTS

function initStudentData() { //init
    var sort;

    if (appEditor.studentData.length) {
        sort = sortStudentData(appEditor.studentData);
        appEditor.studentData = sort;
    }
    reloadStudents(true);
}

function handleStudentsCSV(evt) { //csv upload...
    var file = evt.target.files[0];
    var props,
        len,
        reqProps,
        foundProps,
        i,
        ii;

    if (file.name.substring(file.name.length - 3) !== "csv") {
        displayMsg("m");
        document.getElementById('nputStudents').reset();
        return;
    }

    window.Papa.parse(file, {
        header: true,
        worker: true,
        dynamicTyping: false,
        encoding: "",
        skipEmptyLines: true,
        complete: function (results) {
            document.getElementById('nputStudents').reset();

            if (!results.data.length) { return; }

            props = Object.keys(results.data[0]);
            len = props.length;
            reqProps = ["class", "id", "name"];
            foundProps = [];

            for (i = 0; i < 3; i++) { //reqProps.length === 3
                for (ii = 0; ii < len; ii++) {
                    if (props[i].toLocaleLowerCase === reqProps[i]) {
                        foundProps.push("" + reqProps[i]);
                        break;
                    }
                }
            }
            if (foundProps.length !== 3) { //reqProps.length === 3
                displayMsg("l");
                return;
            }
            parseStudentsCSV(results.data, foundProps);
        }
    });
}

function parseStudentsCSV(data, props) { //prop order MUST be: "class", "id", "name"
    var len = results.data.length;
    var i;

    appEditor.csvStudentData = [];

    for (i = 0; i < len; i++) {
        data[i].stCls = cleanTrailingWs(data[i][props[0]]);
        data[i].stId = cleanTrailingWs(data[i][props[1]]);
        data[i].stNme = cleanTrailingWs(data[i][props[2]]);
        appEditor.csvStudentData.push(data[i]);
    }
    addNewStudentsFromCSV();
}

function createClassDivider() {
    var container = document.getElementById("editStudents_body");
    var frag = document.createDocumentFragment();
    var newDiv = document.createElement("div");

    newDiv.className = "col-lg-12";
    newDiv.style.height = 50 + "px";
    frag.appendChild(newDiv);
    container.appendChild(frag);
}

function addNewStudentsFromCSV() {
    var newIndex = docEl("editStudents_body").childNodes.length;
    var len = appEditor.csvStudentData.length;
    var i;

    appEditor.csvStudentData = sortStudentData(appEditor.csvStudentData);

    if (len === 0) { emptyContent(docEl("editStudents_body")); }

    for (i = 0; i < len - 1; i++) {
        createStudentEl(newIndex + i, appEditor.csvStudentData[i]);

        if (appEditor.csvStudentData[i].stCls !== appEditor.csvStudentData[i + 1].stCls) { createClassDivider(); }
    }
    createStudentEl(newIndex + (len - 1), appEditor.csvStudentData[len - 1]); //add the last student in the list
    createClassDivider();
    appEditor.csvStudentData = [];
}

function sortStudentData(refArr) {
    refArr.sort(function (a, b) { return a.stCls.localeCompare(b.stCls) || a.stNme.localeCompare(b.stNme); });
    return refArr;
}

function reloadStudents(bool) {
    var len = appEditor.studentData.length;
    var i;

    emptyContent(docEl("editStudents_body"));

    if (bool === true) {
        if (len === 0) { //this is a reload, the empty obj was removed before the save
            addNewStudent();
            return;
        }
        for (i = 0; i < len - 1; i++) {
            createStudentEl(i, appEditor.studentData[i]);

            if (appEditor.studentData[i].stCls !== appEditor.studentData[i + 1].stCls) {
                createClassDivider();
            }
        }
        createStudentEl(len - 1, appEditor.studentData[len - 1]); //add the last student in the list
        createClassDivider();
    }
}

function markStudentInfoForDeletion(elIndex) {
    hideEl("yt" + elIndex);
    docEl("yc" + elIndex).value = "";
    docEl("yf" + elIndex).value = "";
    docEl("yn" + elIndex).value = "";
}

function identifyStudentInfoEl(el) {
    var subStr;

    if (el.target !== el.currentTarget) {
        subStr = (el.target.id).substring(0, 2);

        if (subStr === "yd") { markStudentInfoForDeletion((el.target.id).substring(2)); }
        el.stopPropagation();
    }
}

function chkForEmptyFieldsInStudentInfo(elIdIndexes) { //if all fields are empty set -> "mark_null_for_deletion" in the ID field
    var returnVal = true;
    var clssName,
        idName,
        studentName,
        i;

    for (i = 0; i < elIdIndexes.length; i++) {
        clssName = cleanWs(docEl("yc" + elIdIndexes[i]).value);
        idName = cleanWs(docEl("yf" + elIdIndexes[i]).value);
        studentName = cleanWs(docEl("yn" + elIdIndexes[i]).value);

        if (clssName === "" || idName === "" || studentName === "") {
            if (clssName === "" && idName === "" && studentName === "") {
                docEl("yf" + elIdIndexes[i]).value = "marked_null_for_deletion";
            } else {
                returnVal = false;
                break;
            }
        }
    }
    return returnVal;
}

function chkForDupIdsInStudentInfo(elIdIndexes) { //dup.id's are ok AS LONG AS THEY ARE FROM DIFFERENT CLASSES (and not the same class)
    var returnVal = true;
    var arr = [];
    var dupsArr,
        _id,
        _clss,
        idAndclass,
        i;

    for (i = 0; i < elIdIndexes.length; i++) {
        _id = cleanValue(docEl("yf" + elIdIndexes[i]).value);
        _clss = cleanValue(docEl("yc" + elIdIndexes[i]).value);

        if (_id === "marked_null_for_deletion") {
            _id = "marked_null_for_deletion_" + i; //won't change textContent, but will avoid errors in uniqueValues
            arr.push(_id);
            continue;
        }
        idAndclass = "" + _clss + _id;
        arr.push(idAndclass);
    }
    dupsArr = uniqueValues(arr);

    if (dupsArr.length !== arr.length) { returnVal = false; }

    return returnVal;
}

function addNewStudent() {
    var newIndex; //= docEl("editStudents_body").childNodes.length;
    var newObj = {};

    newObj.stCls = "";
    newObj.stId = "";
    newObj.stNme = "";
    appEditor.studentData.push(newObj);
    newIndex = appEditor.studentData.length - 1;
    createStudentEl(newIndex, appEditor.studentData[newIndex]);
    docEl("yt" + newIndex).scrollIntoView({ behavior: "smooth", block: "center" });
}

function exitUpdatedStudents() {
    var len = appEditor.studentData.length;
    var studentObj,
        i;

    for (i = len - 1; i >= 0; i--) {
        studentObj = appEditor.studentData[i];

        if (studentObj.stCls === "" && studentObj.stId === "" && studentObj.stNme === "") {
            appEditor.studentData.splice(i, 1);
        }
    }
    initStudentData();
}

function saveUpdatedStudents() {
    var idsArr = [];
    var childs = docEl("editStudents_body").childNodes;
    var emptyFieldsChk,
        dupIdsChk;

    for (var el in childs) {
        if (childs[el].nodeName === "TR") {
            idsArr.push(childs[el].id.substring(2));
        }
    }

    if (!idsArr.length) {
        updateStudentData(idsArr);
        return;
    }
    emptyFieldsChk = chkForEmptyFieldsInStudentInfo(idsArr);
    dupIdsChk = chkForDupIdsInStudentInfo(idsArr);

    if (emptyFieldsChk === false) {
        displayMsg("k");
        return;
    }
    if (dupIdsChk === false) {
        displayMsg("j");
        return;
    }
    updateStudentData(idsArr);
    initStudentData();
}

function saveStudentData() {
    var uid = firebase.auth().currentUser.uid;

    firebase.database().ref('assessments/' + uid + '/studentData').set(appEditor.studentData, function (e) { //set() overrides all childs at the ref...
        if (e) {
            chkPermission(e);
            displayMsg("a", e);
            return;
        }
        displayMsg("i");
    });
}

function updateStudentData(idsArr) {
    var len = idsArr.length;
    var newObj,
        i;

    appEditor.studentData = [];

    for (i = 0; i < len; i++) {
        newObj = {};

        if (docEl("yf" + idsArr[i]).value !== "marked_null_for_deletion") {
            newObj.stCls = cleanValue(docEl("yc" + idsArr[i]).value);
            newObj.stId = cleanValue(docEl("yf" + idsArr[i]).value);
            newObj.stNme = cleanValue(docEl("yn" + idsArr[i]).value);
            appEditor.studentData.push(newObj);
        }
    }
    saveStudentData();
}

function resetStudents() {
    var allTargetNodes = docEl("editStudents_body").querySelectorAll("input");

    allTargetNodes.forEach(function (target) { target.value = ""; });
}

//UI

function clearActiveMenu() {
    var activeEl = docEl("mainMenu").querySelector("div.btn-primary.active");

    if (activeEl !== null) { activeEl.className = activeEl.className.replace(/(?:^|\s)active(?!\S)/g, ''); }
}

function hideAllEditorViews() {
    clearActiveMenu();
    if (appEditor.editorIsOpen.grader === true) {
        resetGrading(false);
    }
    hideEl("mapContainer");
    hideEl("editRubric");
    hideEl("editFinalRecord");
    hideEl("editStudents");
    hideEl("editSnippets");
    hideEl("components");
    hideEl("editRecordActions");
    hideEl("rubricActions");
    hideEl("snippetActions");
    hideEl("studentActions");
    hideEl("gradeActions");
}

function showEditRecords() {
    if (appEditor.db.records === false) {
        getRecordsIndexFromDb();
    }
    docEl("titleHeader").textContent = "Records";
    showEl("editFinalRecord");

    if (appEditor.editorIsOpen.record === true) {
        showEl("editRecordActions");
    } else {
        showEl("mapContainer");
    }
}

function showEditRubric() {
    if (appEditor.db.rubrics === false) {
        getRubricIndexesFromDb();
    }
    docEl("titleHeader").textContent = "Rubrics";
    showEl("editRubric");

    if (appEditor.editorIsOpen.rubric === true) {
        showEl("rubricActions");
    }
}

function showEditSnippets() {
    if (appEditor.db.snippets === false) {
        getSnippetsFromDb(); //rubric dependency resolved in callback
    }
    docEl("titleHeader").textContent = "Comment snippets";
    showEl("editSnippets");
    showEl("snippetActions");
}

function showEditStudents() {
    if (appEditor.db.students === false) {
        getStudentsFromDb();
    }
    docEl("titleHeader").textContent = "Current students";
    showEl("editStudents");
    showEl("studentActions");
}

function showGrader() {
    docEl("titleHeader").textContent = "Grade";
    hideEl("gaSctnBoxes");
    //showEl("components");

    if (appEditor.db.rubrics === false || appEditor.db.students === false || appEditor.db.snippets === false) {
        getEverythingGraderNeedsFromDb();
    } else {
        initGrader();
    }
}

function exitApp() {
    hideAllEditorViews();
    signOutOfApp();
}

function switchForActiveEditorMenu(elId) {
    hideAllEditorViews();
    docEl(elId).className += " active";

    switch (elId) {
        case "leRecords": showEditRecords();
            break;
        case "leStudents": showEditStudents();
            break;
        case "leRubrics": showEditRubric();
            break;
        case "leSnippets": showEditSnippets();
            break;
        case "leGRADER": showGrader();
            break;
        case "leSignout": exitApp();
            break;
        default: return;
    }
}

function identifyElFromMenu(el) {
    if (el.target !== el.currentTarget) {
        if (el.target.nodeName === "SPAN") {
            switchForActiveEditorMenu(el.target.parentElement.id);
        } else if (el.target.nodeName === "DIV") {
            switchForActiveEditorMenu(el.target.id);
        }
        el.stopPropagation();
    }
}

function switchObjForGradingTokens(elId){
    var subStr = (elId).substring(0, 2);

    switch (subStr) {
        case "gj": sectionlock(elId);
        break;
        case "gp": viewSnippets(elId);
        break;
        case "gc": isChkdOrNot(elId);
        break;
        default: return;
    }
}

function identifyGraderEl(el) {
    if (el.target !== el.currentTarget) {
        if (el.target.nodeName !== "SELECT") {
            switchObjForGradingTokens(el.target.id);
        }
        el.stopPropagation();
    }
}

function lockIcon(elId, bool) {
    if (bool === true) {
        docEl(elId).className = docEl(elId).className.replace(/(?:^|\s)icon-lock-open(?!\S)/g, '');
        docEl(elId).className += " icon-lock";
    }
    else {
        docEl(elId).className = docEl(elId).className.replace(/(?:^|\s)icon-lock(?!\S)/g, '');
        docEl(elId).className += " icon-lock-open";
    }
}

function showOrHideSaveBtn(bool) {
    if (bool === true) {
        showEl("gradeActions");
        return;
    }
    hideEl("gradeActions");
}

function displayLockedText(sectionIndex, bool) {
    var text = "";
    var tempScores = appEditor.grader.tempRecord.scores[sectionIndex];
    var critName,
        scoreVal,
        descr,
        i;

    if (bool !== true) {
        hideEl("gv" + sectionIndex);
        return;
    }
    var len = tempScores.length - 1;

    for ( i = 0; i <= len; i++ ) {
        critName = appEditor.grader.rubric[sectionIndex].sectionDef[tempScores[i][1]].criteriaName;
        scoreVal = appEditor.grader.rubric[sectionIndex].sectionDef[tempScores[i][1]].criteriaDef[tempScores[i][2]].score;
        descr = appEditor.grader.rubric[sectionIndex].sectionDef[tempScores[i][1]].criteriaDef[tempScores[i][2]].descriptor;
        text += critName + " " + scoreVal + ":\r\n - " + descr + "\r\n";
    }
    if (appEditor.grader.tempRecord.comments[sectionIndex] !=="") {
        text += "\r\nComment:\r\n - " + appEditor.grader.tempRecord.comments[sectionIndex] + "\r\n";
    }
    docEl("gv" + sectionIndex).textContent = text;
    showEl("gv" + sectionIndex);
}

function identifyChkBox(el) {
    var elId;

    if (el.target !== el.currentTarget) {
        if (el.target.nodeName === "INPUT") { //el.target.nodeName !== "LABEL"
            elId = el.target.id;
            sendChkBoxValToTempRecord(elId);
        }
        el.stopPropagation();
    }
}

function sendChkBoxValToTempRecord(elId) {
    var section = docEl(elId);
    var val = Number(section.value);
    var isChkd = section.checked;

    if (isChkd === true) {
        addSelectedToActiveSectionsArr(val);
    } else if (isChkd === false) {
        removeSelectedFromActiveSectionsArr(val);
    }
}

function showGraderMap(){
    hideEl("userInput");
    showEl("mapgcontainer");
}

function hideGraderMap(){
    hideEl("mapgcontainer");
    showEl("userInput");
}

function findStudentInGradingMap(el) {
    if (el.target !== el.currentTarget) {
        var subStr = (el.target.id).substring(0, 2);

        if (subStr === "gy") {
            selectStudentFromDatasets(el.target.id, false);
        } else if (subStr === "gh") {
            togglegMapContent(el.target.id);
        }
        el.stopPropagation();
    }
}

function togglegMapContent(elId) {
    var targetElId = "gb" + elId.substring(2);
    var isCollapsed = docEl(targetElId).classList.contains("nodisplay");

    if (isCollapsed) {
        docEl(elId).className = docEl(elId).className.replace(/(?:^|\s)collpsd(?!\S)/g, '');
        showEl(targetElId);
    } else {
        docEl(elId).className += " collpsd";
        hideEl(targetElId);
    }
}

function filterCandidatesByClass() {
    var selectBox1 = docEl("chooseClass");
    var targetDiv = docEl("select-styleB");
    var cls = selectBox1.options[selectBox1.selectedIndex].value;

    if (cls !=="") {
        populateStudentsByClass(cls, false);
        targetDiv.className = targetDiv.className.replace(/(?:^|\s)invisible(?!\S)/g, '');
    }
}

function setSelectedFromgMap(cls, sid, nme) { //el.dataset.cls, el.dataset.sid, el.dataset.nme
    var selectBox1 = docEl("chooseClass");
    var selectBox2 = docEl("chooseId");
    var ssId,
        ssName,
        ssCls,
        i;

    for (i= 0; i < selectBox1.options.length; i++) {
        ssCls = selectBox1.options[i].value;

        if (ssCls === cls) {
            selectBox1.options[i].selected = true;
            break;
        }
    }
    populateStudentsByClass(cls, true);

    for (i= 0; i < selectBox2.options.length; i++) {
        ssId = selectBox2.options[i].value;
        ssName = selectBox2.options[i].dataset.nme;

        if (ssId === sid && ssName === nme) {
            selectBox2.options[i].selected = true;
            break;
        }
    }
    setThisCandidate();
    hideGraderMap();
}

function setThisCandidate() {
    var selectBox1 = docEl("chooseClass");
    var selectBox2 = docEl("chooseId");

    appEditor.grader.tempRecord.class = selectBox1.options[selectBox1.selectedIndex].value;
    appEditor.grader.tempRecord.ssId = selectBox2.options[selectBox2.selectedIndex].value;
    appEditor.grader.tempRecord.ssName = selectBox2.options[selectBox2.selectedIndex].dataset.nme;
    docEl("thisgClass").textContent = appEditor.grader.tempRecord.class;
    docEl("thisgStudent").textContent = appEditor.grader.tempRecord.ssId + " " + appEditor.grader.tempRecord.ssName;
    hideEl("studentgSlct");
    showEl("studentgInfo");
}

function resetSingleCandidate() {
    var selectBox2 = docEl("chooseId");
    var targetDiv = docEl("select-styleB");

    if (selectBox2.hasChildNodes("option") === true) {
        selectBox2.options[0].selected = true;
    }
    appEditor.grader.tempRecord.ssId = "";
    appEditor.grader.tempRecord.ssName = "";
    targetDiv.className = targetDiv.className.replace(/(?:^|\s)invisible(?!\S)/g, '');
    docEl("gOvrllScr").value = "";
    hideEl("studentgInfo");
    showEl("studentgSlct");
}

function setContext(val) {
    appEditor.grader.tempRecord.context = val;
    hideEl("ctxContent");
    docEl("ctxContent").value = "";
}

function feContextVal() {
    setContext("Final Exam");
}

function mteContextVal() {
    setContext("Midterm Exam");
}

function hwContextVal() {
    setContext("Homework");
}

function assgnContextVal() {
    setContext("Assignment");
}

function otherContextVal() {
    appEditor.grader.tempRecord.context = docEl("ctxContent").value;
    showEl("ctxContent");
}

function showUserInput() {
    hideEl("components");
    showEl("userInput");
}

function identifyGradingSnippet(el) {
    var elId;

    if (el.target.nodeName !== "LABEL") {
        elId = el.target.id;
        switchObjForGradingTokens(elId);
    }
    el.stopPropagation();
}

function gradingSnippetsExit(bool) {
    hideEl("viewgSnppts");
    reloadSnippets(bool);
    showEl("userInput");
    appEditor.grader.tempRecord.tempSelectedSnippets = []; //clear the array
}

function resetDataEntry() { //don't clear the general feedback for the next student
    var selectEls = docEl("datgEntry").querySelectorAll("select");
    var elId,
        lastSibling,
        i,
        ii;

    selectEls.forEach(function (el) {
        el.selectedIndex = 0;
        lastSibling = el.id.substring(0, (el.id.lastIndexOf("-") + 1)) + "3";
        docEl(lastSibling).textContent = "";
    });
    appEditor.grader.tempRecord.ssId = "";
    appEditor.grader.tempRecord.ssName = "";

    for (i = 0; i < appEditor.grader.tempRecord.scores.length; i++) {
        elId = "gj" + i;
        unlockThisSection(elId, i);
        appEditor.grader.tempRecord.comments[i] = "";
        docEl("gk" + i).textContent = "";

        for (ii = 0; ii < appEditor.grader.tempRecord.scores[i].length; ii++) {
            appEditor.grader.tempRecord.scores[i][ii] = [];
        }
    }
    resetSingleCandidate();
    if (appEditor.grader.noRubricCommentsOnly !== true) { hideEl("gradeActions"); }
}

function chkSetUpToGetStarted() {
    if (docEl("ctxContent").value !=="" && docEl("ctxOther").checked === true) {
        appEditor.grader.tempRecord.context = docEl("ctxContent").value;
    }
    if (appEditor.grader.tempRecord.context === "") {
        displayMsg("w");
        return false;
    }
    if (appEditor.grader.noRubricCommentsOnly === true) { return true; }

    if (appEditor.grader.tempRecord.activeSections.length === 0) {
        displayMsg("x");
        return false;
    }
    return true;
}

function resetGradingFromBtn() { //btn onclick
    resetGrading(true);
}

function resetGrading(bool) {
    appEditor.grader.rubric = [];
    appEditor.grader.loadedRubric = [];
    appEditor.grader.tempRecord.activeSections = [];
    appEditor.grader.noRubricCommentsOnly = false;
    resetSingleCandidate();
    assgnContextVal();
    docEl('ctxAssgn').checked = true;
    docEl("gOvrllScr").value = "";
    docEl("gOvrllMax").value = "";
    docEl('gFbWritten').textContent = "";
    hideEl("gaSctnBoxes");
    hideEl("userInput");
    hideEl("viewgSnppts");
    hideEl("mapgcontainer");
    hideEl("gradeActions");
    hideEl("components");
    docEl("select-styleB").className += " invisible";

    if (appEditor.editorIsOpen.grader === true) {
        gradingHandlersOff();
        appEditor.editorIsOpen.grader = false;
    }
    if (appEditor.editorIsOpen.graderSetup === true) {
        setUpHandlersOff();
        appEditor.editorIsOpen.graderSetup = false;
    }
    emptyContent(docEl("gaCbContainer"));

    if (bool === true) {
        docEl("titleHeader").textContent = "Grade";
        initGrader();
    }
}

function identifyRubricRadio(el) {
    if (el.target !== el.currentTarget) {
        if (el.target.nodeName === "INPUT") { //i.e. el.target.nodeName !== "LABEL"
            if (el.target.id === "_sanz_rubrik") {
                getNoRubricRubric();
                return;
            }
            var idx = (el.target.id).substring(2);

            getSelectedRubric(idx);
        }
        el.stopPropagation();
    }
}

function showSectionsForSelectedRubric(idx) {
    hideEl("gaSctnBoxes");
    appEditor.grader.tempRecord.activeSections = [];

    if (docEl("_sanz_rubrik").checked === true) {
        setUpChkbxSections(false);
        showEl("gaSctnBoxes");
        return;
    }
    if (docEl("gr" + idx).checked === true) {
        appEditor.grader.noRubricCommentsOnly = false;
        appEditor.grader.rubricFilter = [];
        appEditor.grader.rubricFilter = JSON.parse(JSON.stringify(appEditor.grader.loadedRubric[0].rubricDef)); //.slice()
        appEditor.grader.tempRecord.rubricRef = "" + appEditor.grader.loadedRubric[0].rubricName;
        setUpChkbxSections(true);
        showEl("gaSctnBoxes");
    }
}

function identifyGradingSelectopt(el) {
    if (el.target !== el.currentTarget) {
        if (el.target.nodeName === "SELECT") { //onchange Score dropdown: update the relevant descriptor from the accompanying rubric
            updateGradingDescriptorOnScoreChange(el.target.id);
        }
        el.stopPropagation();
    }
}

function letsGetStarted() {
    var canStart = chkSetUpToGetStarted();

    if (canStart !== true) { return; }

    appEditor.editorIsOpen.grader = true;
    appEditor.editorIsOpen.graderSetup = false;
    appEditor.grader.rubric = [];
    showEl("viewRubricDuringGrading");
    hideEl("viewNoRubricOverallScore");

    if (appEditor.grader.noRubricCommentsOnly === true) {
        docEl("gRbChkd").checked = false;
        hideEl("viewRubricDuringGrading");
        showEl("viewNoRubricOverallScore");
        showOrHideSaveBtn(true);
    }
    appEditor.grader.rubric = createSlimRubric();
    defineTempRecord();
    populateGraderUI();
    setUpHandlersOff();
    gradingHandlersOn();
    startSnippets();
    showUserInput();
    populateFullRubric();
}

function viewFullRubric() {
    hideEl("userInput");
    showEl("gaFullRb");
}

function closeFullRubric() {
    hideEl("gaFullRb");
    showEl("userInput");
}

function showMenu() {
    showEl("contentsBox");
    showEl("leRecords");
    showEl("leStudents");
    showEl("leRubrics");
    showEl("leSnippets");
    showEl("leGRADER");
}

function buildTokens(elId, char) {
    var arr = elId.split(char);

    arr = arr.map(function(el) { return Number(el); });
    return arr;
}

function hideEl(elId) {
    if (!docEl(elId).classList.contains('nodisplay')) {
        docEl(elId).className += ' nodisplay';
    }
}

function showEl(elId) {
    docEl(elId).className = docEl(elId).className.replace(/(?:^|\s)nodisplay(?!\S)/g, '');
}

function enableEl(elId) {
    docEl(elId).className = docEl(elId).className.replace( /(?:^|\s)disabledbutton(?!\S)/g , '' );
}

function disableEl(elId) {
    docEl(elId).className += ' disabledbutton';
    window.scrollTo(0, 0);
}

function initGrader() { //a default "No rubric" rubric (comments only) is set @loadGraderRubriks()
    if (appEditor.db.students === false) { return; }
    if (!appEditor.studentData.length || (appEditor.studentData.length === 1 && appEditor.studentData[0].stCls === "")) { //placeholder obj.
        hideEl("components");
        displayMsg("c", "No student data was found.");
        return;
    }
    showEl("components");
    showEl("gaLoading");
    loadGraderRubriks();
}

function finishInit() {
    buildStudentgMap();
    populateAllgClassesSelectBox();
}

function resetUiAfterDwnld(elId) {
    toggleAllRecordChkBoxesOff();
    docEl(elId).className = docEl(elId).className.replace(/(?:^|\s)invisible(?!\S)/g, '');
}

function tableClick(e) {
    var elClssName;

    if (e.target !== e.currentTarget) {
        elClssName = e.target.className;

        switch (elClssName) {
            case "criterias": rowName(e);
                break;
            case "dropbtn": rowDown(e);
                break;
            case "row-insert-top": rowTop(e);
                break;
            case "row-insert-bottom": rowBtm(e);
                break;
            case "row-delete": rowDel(e);
                break;
            default: return;
        }
    }
    //e.stopPropagation();
}

function headersClick(e) {
    var elClssName;

    if (e.target !== e.currentTarget) {
        elClssName = e.target.className;

        switch (elClssName) {
            case "dropbtn": colDown(e);
                break;
            case "col-insert-left": colLeft(e);
                break;
            case "col-insert-right": colRight(e);
                break;
            case "col-delete": colDel(e);
                break;
            default: return;
        }
    }
    //e.stopPropagation();
}

function resetBtn(e) {
    var indices = (e.target.id).split("-");

    switch (indices[0]) {
        case "hk": resetRenameOk(indices);
            break;
        case "hz": resetRenameExit(indices);
            break;
        case "hs": resetReset(indices);
            break;
        case "hd": resetDelete(indices);
            break;
        default: return;
    }
    e.stopPropagation();
}

//PDF

function pdfMakePromise(recordContent) {
    var pdfDocGenerator = pdfMake.createPdf(recordContent);

    return new window.Promise(function (resolve) {
        pdfDocGenerator.getBase64(function (pdfBase64) {
            resolve(pdfBase64);
        });
    });
}

function pdfObjPromise(recordObj) {
    return new window.Promise(function (resolve) {
        pdfMakePromise(recordObj.content).then(function (result) {
            recordObj.content = {};
            recordObj.content.base64 = result;
            resolve(recordObj);
        });
    });
}

function addToZip(pdfObjArr, elId) {
    var allPromises = [];

    pdfObjArr.forEach(function (recordObj) {
        allPromises.push(pdfObjPromise(recordObj));
    });
    window.Promise.all(allPromises).then(function (resultArr) {
        makeZipAndDl(resultArr, elId);
    });
}

function makeZipAndDl(resultArr, elId) {
    var zip = new JSZip();
    var zipName = "Record_downloads.zip";

    resultArr.forEach(function (recordObj) {
        zip.file(recordObj.name, recordObj.content.base64, { base64: true });
    });
    zip.generateAsync({ type: "blob" }).then(function (data) {
        window.saveAs(data, zipName);
        resetUiAfterDwnld(elId);
    });
}

function dlSingleRecord(recordObj, elId) {
    var pdfObj = buildPDFrecord(recordObj);
    var pdfName = '' + recordObj.studentData.stCls + '_' + recordObj.studentData.stNme + '_' + recordObj.studentData.stId + '_' + recordObj.context + '.pdf';

    pdfMake.createPdf(pdfObj).download(pdfName);
    resetUiAfterDwnld(elId);
}

function buildPDFrecord(recordObj) {
    var pdfObj = {};
    var count;
    var totalScore = [0, 0];
    var i;
    var ii;
    var pdfDate = new Date(recordObj.timeStamp).toLocaleDateString();
    var displayName = recordObj.studentData.stId + " " + recordObj.studentData.stNme;
    var displayNameURI = getTextAsImageURI(displayName);

    pdfObj.styles = { header: { fontSize: 14, bold: true, margin: [0, 0, 0, 10] }, subheader: { fontSize: 12, bold: true, margin: [0, 10, 0, 5] }, tableExample: { margin: [0, 3, 0, 3] }, tableHeader: { bold: true, fontSize: 13, color: "black" }, smallerTxt: { fontSize: 8 } };
    pdfObj.defaultStyle = { fontSize: 11 };
    pdfObj.pageSize = "A4"; //A4 pageSize: 595.28 - (40 x 2 margin)
    pdfObj.content = [];
    pdfObj.pageBreakBefore = function (currentNode, followingNodesOnPage /*,nodesOnNextPage,previousNodesOnPage*/) { return currentNode.headlineLevel === 1 && followingNodesOnPage.length === 0; };
    pdfObj.content.push({ text: pdfDate, alignment: "left", fontSize: 10, margin: [0, -10, 0, 1] });
    pdfObj.content.push({ columns: [{ text: recordObj.context, alignment: "left", fontSize: 14 }, { image: displayNameURI, width: 100, alignment: "right" }] });

    for (i = 0; i < recordObj.scores.length; i++) {
        count = 0;
        for (ii = 0; ii < recordObj.scores[i].length; ii++) {
            var scre = recordObj.scores[i][ii][1];
            var mxScre = recordObj.scores[i][ii][2];

            if (count === 0) {
                pdfObj.content.push({ text: recordObj.sectionNames[i], fontSize: 12, bold: true, margin: [0, 6, 0, 3] });
            }
            totalScore[0] += Number(scre);
            totalScore[1] += Number(mxScre);

            if (recordObj.scores[i][ii][3] === "") { //then there is no descriptor and therefore no fillColor...
                pdfObj.content.push({ text: recordObj.scores[i][ii][0] + ": " + scre + "/" + mxScre }, { style: "tableExample", table: { widths: ["*"], body: [[{ border: [false, false, false, false], text: "", fontSize: 10 }]] }, layout: { "defaultBorder": false } });
            } else {
                pdfObj.content.push({ text: recordObj.scores[i][ii][0] + ": " + scre + "/" + mxScre }, { style: "tableExample", table: { widths: ["*"], body: [[{ border: [false, false, false, false], fillColor: "#eeeeee", text: recordObj.scores[i][ii][3], fontSize: 10 }]] }, layout: { "defaultBorder": false } });
            }
            count++;
        }

        if (recordObj.comments[i] !== "") {
            pdfObj.content.push({ text: "Comment:" }, { style: "tableExample", table: { widths: ["*"], body: [[{ border: [false, false, false, false], text: recordObj.comments[i], fontSize: 10 }]] }, layout: { defaultBorder: false } });
        }
    }
    pdfObj.content.push({ text: "" + totalScore[0] + "/" + totalScore[1] + "", alignment: "right", fontSize: 14, margin: [0, 6, 0, 0] });

    if (recordObj.feedback.written !== "") {
        pdfObj.content.push({ text: "General Feedback:", fontSize: 12, bold: true, margin: [0, 6, 0, 3] });
        pdfObj.content.push({ text: recordObj.feedback.written, fontSize: 11, margin: [0, 0, 0, 3] });
    }
    if (recordObj.feedback.rubricChkd === true) {
        for (i = 0; i < recordObj.feedback.rubric.length; i++) {
            pdfObj.content.push(fullRubricForPdf(recordObj.feedback.rubric[i]));
        }
    }
    clearTxtCanvas();
    return pdfObj;
}

function fullRubricForPdf(rubricSection) {
    var fullRubricPdfObj = { pageBreak: 'before', pageOrientation: 'landscape', style: 'smallerTxt', table: { headerRows: 1, dontBreakRows: true, keepWithHeaderRows: 1, body: [] } };
    var i,
        ii;
    var numOfRows = rubricSection.sectionDef.length;
    var isRowStart = true;
    var isFirstRow = true;
    var isColStart;
    var numOfCells;
    var arr = [];

    for (i = 0; i < numOfRows; i++) { //header row
        numOfCells = rubricSection.sectionDef[i].criteriaDef.length;

        for (ii = 0; ii < numOfCells; ii++) {
            if (isFirstRow === true) { //define the first row
                if (isRowStart === true) {
                    arr.push("RUBRIC\r\n" + rubricSection.sectionName);
                    isRowStart = false;
                }
                arr.push(rubricSection.sectionDef[i].criteriaDef[ii].score);
            }
        }
        isFirstRow = false;
    }
    fullRubricPdfObj.table.body.push(arr);

    for (i = 0; i < numOfRows; i++) { //body
        arr = [];
        numOfCells = rubricSection.sectionDef[i].criteriaDef.length;
        isColStart = true;

        for (ii = 0; ii < numOfCells; ii++) {
            if (isColStart === true) {
                arr.push(rubricSection.sectionDef[i].criteriaName);
                isColStart = false;
            }
            arr.push(rubricSection.sectionDef[i].criteriaDef[ii].descriptor);
        }
        fullRubricPdfObj.table.body.push(arr);
    }

    return fullRubricPdfObj;  //append to content []
}

function dlNewRecord() {
    var pdfObj = buildNewPDFrecord();
    var ssClassPdf = charsToUnderscore(appEditor.grader.tempRecord.class);
    var ssIdPdf = charsToUnderscore(appEditor.grader.tempRecord.ssId);
    var ssNamePdf = charsToUnderscore(appEditor.grader.tempRecord.ssName);

    pdfMake.createPdf(pdfObj).download('' + ssClassPdf + '_' + ssNamePdf + '_' + ssIdPdf + '_' + appEditor.grader.tempRecord.context + '.pdf');
}

function buildNewPDFrecord(){
    var pdfObj = {};
    var totalScore = [0,0];
    var strScore = "";
    var dateTime = Date.now();
    var pdfDate = new Date(dateTime).toLocaleDateString();
    var displayName = appEditor.grader.tempRecord.ssId + " " + appEditor.grader.tempRecord.ssName;
    var displayNameURI = getTextAsImageURI(displayName);
    var recordVal,
        genScore,
        count,
        i,
        ii;

    pdfObj.styles = {header:{fontSize:14,bold:true,margin:[0,0,0,10]},subheader:{fontSize:12,bold:true,margin:[0,10,0,5]},tableExample:{margin:[0,3,0,3]},tableHeader:{bold:true,fontSize:13,color:"black"},smallerTxt:{fontSize:8}};
    pdfObj.defaultStyle = {fontSize:11};
    pdfObj.pageSize = "A4"; //A4 pageSize: 595.28 - (40 x 2 margin)
    pdfObj.content = [];
    pdfObj.pageBreakBefore = function(currentNode,followingNodesOnPage /*,nodesOnNextPage,previousNodesOnPage*/){return currentNode.headlineLevel===1&&followingNodesOnPage.length=== 0;};
    pdfObj.content.push({text:pdfDate,alignment:"left",fontSize:10,margin:[0,-10,0,1]});
    pdfObj.content.push({columns:[{text:appEditor.grader.tempRecord.context,alignment:"left",fontSize:14},{image:displayNameURI,width:100,alignment:"right"}]});

    if (appEditor.grader.noRubricCommentsOnly === true) {
        genScore = getGenScoreForNoRubric("gOvrllScr", "gOvrllMax");

        if (genScore[0] !=="" && (genScore[1] !=="" || genScore[1] !=="0")) {
            strScore += genScore[0] + "/" + genScore[1];
        }
    } else {
        for ( i = 0; i < appEditor.grader.tempRecord.scores.length; i++ ) {
            count = 0;
            for ( ii = 0; ii < appEditor.grader.tempRecord.scores[i].length; ii++ ) {
                recordVal = getTempRecordVariables(i, ii);
                if (count === 0) {
                    pdfObj.content.push({text:recordVal.sectionName,fontSize:12,bold:true,margin:[0,6,0,3]});
                }
                totalScore[0] += Number(recordVal.score);
                totalScore[1] += Number(recordVal.maxScore);
                pdfObj.content.push({text:recordVal.criteria + ": " + recordVal.score + "/" + recordVal.maxScore},{style:"tableExample",table:{widths:["*"],body:[[{border:[false,false,false,false],fillColor:"#eeeeee",text:recordVal.descriptor,fontSize:10}]]},layout:{"defaultBorder":false}});
                count++;
            }
            if (appEditor.grader.tempRecord.comments[i] !=="") {
                var aComment = appEditor.grader.tempRecord.comments[i];
                pdfObj.content.push({text:"Comment:"},{style:"tableExample",table:{widths:["*"],body:[[{border:[false,false,false,false],text:aComment,fontSize:10}]]},layout:{defaultBorder:false}});
            }
        }
        strScore += totalScore[0] + "/" + totalScore[1];
    }
    pdfObj.content.push({text:strScore,alignment:"right",fontSize:14,margin:[0,6,0,0]});

    if (appEditor.grader.tempRecord.feedback.written !=="") {
        pdfObj.content.push({text:"General Feedback:",fontSize:12,bold:true,margin:[0,6,0,3]});
        if (appEditor.grader.tempRecord.feedback.written !=="") {
             var feedbackComment = appEditor.grader.tempRecord.feedback.written;
             pdfObj.content.push({text:feedbackComment,fontSize:11,margin:[0,0,0,3]});
        }
    }
    if (document.getElementById("gRbChkd").checked === true){
        for ( i = 0; i < appEditor.grader.rubric.length; i++ ) {
            pdfObj.content.push(fullRubricForNewPdf(appEditor.grader.rubric[i]));
        }
    }
    clearTxtCanvas();
    return pdfObj;
}

function fullRubricForNewPdf(rubricSection) {
    var fullRubricPdfObj = {
        pageBreak: 'before',
        pageOrientation: 'landscape',
        style: 'smallerTxt',
        table: {
            headerRows: 1,
            dontBreakRows: true,
            keepWithHeaderRows: 1,
            body: []
        }
    };
    var numOfRows = rubricSection.sectionDef.length;
    var isRowStart = true;
    var isFirstRow = true;
    var arr = [];
    var isColStart,
        numOfCells,
        i,
        ii;

    for (i = 0; i < numOfRows; i++) { //header row
        numOfCells = rubricSection.sectionDef[i].criteriaDef.length;

        for (ii = 0; ii < numOfCells; ii++) {
            if (isFirstRow === true){//define the first row
                if (isRowStart === true) {
                    arr.push("RUBRIC\r\n" + rubricSection.sectionName);
                    isRowStart = false;
                }
                arr.push(rubricSection.sectionDef[i].criteriaDef[ii].score);
            }
        }
        isFirstRow = false;
    }
    fullRubricPdfObj.table.body.push(arr);

    for (i = 0; i < numOfRows; i++) { //body
        arr = [];
        numOfCells = rubricSection.sectionDef[i].criteriaDef.length;
        isColStart = true;

        for (ii = 0; ii < numOfCells; ii++) {
            if (isColStart === true) {
                arr.push(rubricSection.sectionDef[i].criteriaName);
                isColStart = false;
            }
            arr.push(rubricSection.sectionDef[i].criteriaDef[ii].descriptor);
        }
        fullRubricPdfObj.table.body.push(arr);
    }
    return fullRubricPdfObj;  //append to content []
}

//HANDLERS
function oneClickAndRemoveHandler() {
    docEl("mainMenu").removeEventListener("click", oneClickAndRemoveHandler, { capture: false, passive: true });
    emptyContent(docEl("welcomeMsg"));
}

function rubrikHandlersOn() {
    docEl("newRubrikSectionBtn").addEventListener("click", initNewSectionFromNew, { capture: false, passive: true });
    docEl("editRubric").addEventListener("click", closeDropBtn, { capture: false, passive: true });
    docEl("ruCreateNew").addEventListener("click", newRubrik, { capture: false, passive: true });
    docEl("ac_ru_commit").addEventListener("click", commitRubrik, { capture: false, passive: true });
    docEl("ac_ru_dis").addEventListener("click", discardRubrik, { capture: false, passive: true });
    docEl("ruLoadSelected").addEventListener("click", selectLoadedRubrik, { capture: false, passive: true });
    docEl("ac_ru_del").addEventListener("click", destroyRubrik, { capture: false, passive: true });
    docEl("rubrik").addEventListener("paste", getPaste, false);
}

function studentInfoHandlersOn() {
    docEl("ac_st_add").addEventListener("click", addNewStudent, { capture: false, passive: true });
    docEl("ac_st_exit").addEventListener("click", exitUpdatedStudents, { capture: false, passive: true });
    docEl("ac_st_save").addEventListener("click", saveUpdatedStudents, { capture: false, passive: true });
    docEl("editStudents_table").addEventListener("click", identifyStudentInfoEl, { capture: false, passive: true });
    docEl("studentfile").addEventListener('change', handleStudentsCSV, { capture: false, passive: true });
    docEl("ac_st_reset").addEventListener('click', resetStudents, { capture: false, passive: true });
    docEl("editStudents_table").addEventListener("paste", getPaste, false);
}

function snippetHandlersOn() {
    docEl("snptsTbd").addEventListener("click", identifySnippet, { capture: false, passive: true });
    docEl("ac_sn_save").addEventListener("click", saveChangesToSnippets, { capture: false, passive: true });
    docEl("ac_sn_add").addEventListener("click", addNewSnippet, { capture: false, passive: true });
    docEl("ac_sn_dis").addEventListener("click", coldExitSnippets, { capture: false, passive: true });
    docEl("snptsTbd").addEventListener("paste", getPaste, false);
}

function recordsHandlersOn() {
    docEl("recordsContainer").addEventListener("change", identifySelectopt, { capture: false, passive: true });
    docEl("recordsContainer").addEventListener("click", identifyEditRecordEl, { capture: false, passive: true });
    docEl("ac_re_update").addEventListener("click", chkAllRecordsBeforeUpdate, { capture: false, passive: true });
    docEl("ac_re_exit").addEventListener("click", exitUpdateRecords, { capture: false, passive: true });
    docEl("recordsMap").addEventListener("click", findStudentInRecordsMap, { capture: false, passive: true });
    docEl("showmap").addEventListener("click", exitUpdateRecords, { capture: false, passive: true });
    docEl("recordsContainer").addEventListener("paste", getPaste, false);
}

function setUpHandlersOn() {
    docEl("catsSet").addEventListener("click", letsGetStarted, { capture: false, passive: true });
    docEl("ctxFe").addEventListener("click", feContextVal, { capture: false, passive: true });
    docEl("ctxMte").addEventListener("click", mteContextVal, { capture: false, passive: true });
    docEl("ctxHw").addEventListener("click", hwContextVal, { capture: false, passive: true });
    docEl("ctxAssgn").addEventListener("click", assgnContextVal, { capture: false, passive: true });
    docEl("ctxOther").addEventListener("click", otherContextVal, { capture: false, passive: true });
    docEl("gaCbContainer").addEventListener("click", identifyChkBox, { capture: false, passive: true });
    docEl("gaLoadChkBoxes").addEventListener("click", identifyRubricRadio, { capture: false, passive: true });
}

function setUpHandlersOff() {
    docEl("catsSet").removeEventListener("click", letsGetStarted, { capture: false, passive: true });
    docEl("ctxFe").removeEventListener("click", feContextVal, { capture: false, passive: true });
    docEl("ctxMte").removeEventListener("click", mteContextVal, { capture: false, passive: true });
    docEl("ctxHw").removeEventListener("click", hwContextVal, { capture: false, passive: true });
    docEl("ctxAssgn").removeEventListener("click", assgnContextVal, { capture: false, passive: true });
    docEl("ctxOther").removeEventListener("click", otherContextVal, { capture: false, passive: true });
    docEl("gaCbContainer").removeEventListener("click", identifyChkBox, { capture: false, passive: true });
    docEl("gaLoadChkBoxes").removeEventListener("click", identifyRubricRadio, { capture: false, passive: true });
}

function gradingHandlersOn() {
    docEl("datgEntry").addEventListener("change", identifyGradingSelectopt, { capture: false, passive: true });
    docEl("datgEntry").addEventListener("click", identifyGraderEl, { capture: false, passive: true });
    docEl('chooseClass').addEventListener('change', filterCandidatesByClass, { capture: false, passive: true });
    docEl('chooseId').addEventListener('change', setThisCandidate, { capture: false, passive: true });
    docEl('resetStudent').addEventListener('click', resetSingleCandidate, { capture: false, passive: true });
    docEl("ac_gr_save").addEventListener('click', commitNewRecord, { capture: false, passive: true });
    docEl("ac_gr_dl").addEventListener('click', dlNewRecordAndSave, { capture: false, passive: true });
    docEl('mgap').addEventListener('click', findStudentInGradingMap, { capture: false, passive: true });
    docEl('showgMap').addEventListener('click', showGraderMap, { capture: false, passive: true });
    docEl('snpptgContainer').addEventListener("click", identifyGradingSnippet, { capture: false, passive: true });
    docEl('textApaste').addEventListener("click", viewSnippetsForTextA, { capture: false, passive: true });
    docEl('snpptgSave').addEventListener("click", pasteAndCloseSnippets, { capture: false, passive: true });
    docEl('snpptgExit').addEventListener("click", exitGradingSnippets, { capture: false, passive: true });
    docEl('resetGrader').addEventListener("click", resetGradingFromBtn, { capture: false, passive: true });
    docEl("userInput").addEventListener("paste", getPaste, false);
    docEl("gaRbAttchd").addEventListener("click", viewFullRubric, { capture: false, passive: true });
    docEl("closeGaRbAttchd").addEventListener("click", closeFullRubric, { capture: false, passive: true });
}

function gradingHandlersOff() {
    docEl("datgEntry").removeEventListener("change", identifyGradingSelectopt, { capture: false, passive: true });
    docEl("datgEntry").removeEventListener("click", identifyGraderEl, { capture: false, passive: true });
    docEl('chooseClass').removeEventListener('change', filterCandidatesByClass, { capture: false, passive: true });
    docEl('chooseId').removeEventListener('change', setThisCandidate, { capture: false, passive: true });
    docEl('resetStudent').removeEventListener('click', resetSingleCandidate, { capture: false, passive: true });
    docEl("ac_gr_save").removeEventListener('click', commitNewRecord, { capture: false, passive: true });
    docEl("ac_gr_dl").removeEventListener('click', dlNewRecordAndSave, { capture: false, passive: true });
    docEl('mgap').removeEventListener('click', findStudentInGradingMap, { capture: false, passive: true });
    docEl('showgMap').removeEventListener('click', showGraderMap, { capture: false, passive: true });
    docEl('snpptgContainer').removeEventListener("click", identifyGradingSnippet, { capture: false, passive: true });
    docEl('textApaste').removeEventListener("click", viewSnippetsForTextA, { capture: false, passive: true });
    docEl('snpptgSave').removeEventListener("click", pasteAndCloseSnippets, { capture: false, passive: true });
    docEl('snpptgExit').removeEventListener("click", exitGradingSnippets, { capture: false, passive: true });
    docEl('resetGrader').removeEventListener("click", resetGradingFromBtn, { capture: false, passive: true });
    docEl("userInput").removeEventListener("paste", getPaste, false);
    docEl("gaRbAttchd").removeEventListener("click", viewFullRubric, { capture: false, passive: true });
    docEl("closeGaRbAttchd").removeEventListener("click", closeFullRubric, { capture: false, passive: true });
}

function initSuccess(name) {
    buildWelcomeMsg(name, true);
    docEl("mainMenu").addEventListener("click", oneClickAndRemoveHandler, {capture:false, passive: true});
    docEl("mainMenu").addEventListener("click", identifyElFromMenu, {capture:false, passive: true});
    showMenu();
}

function newRubrikHandlersOn() {
    docEl("ruNewSaveBtn").addEventListener("click", initNewRubrik, { capture: false, passive: true });
    docEl("ruNewExitBtn").addEventListener("click", coldExitNewRubrik, { capture: false, passive: true });
}

function newRubrikHandlersOffAndExit() {
    hideEl("ruNewRubricName");
    docEl("ruNewSaveBtn").removeEventListener("click", initNewRubrik, { capture: false, passive: true });
    docEl("ruNewExitBtn").removeEventListener("click", coldExitNewRubrik, { capture: false, passive: true });
}

function initNewSection(val, bool) {
    var isDup = bool;
    var htmlId;

    if (isDup === true) {
        displayMsg("g");
        return;
    } else if (val !== "" && isDup === false) {
        htmlId = getKeyGivenValue(appEditor.table_lookup, val);
        createNewSectionTable(htmlId);
        createSpreadsheet(true);
        docEl("hs-" + htmlId).addEventListener("click", resetBtn);
        docEl("hd-" + htmlId).addEventListener("click", resetBtn);
        docEl("hk-" + htmlId).addEventListener("click", resetBtn);
        docEl("hz-" + htmlId).addEventListener("click", resetBtn);
    }
    docEl("newRubrikSection").value = "";
}

function removeOldListeners(tableId) {
    var tableHeaders = docEl("table-headers-" + tableId);
    var tableBody = docEl("table-body-" + tableId);

    if (tableBody !== null) {
        tableBody.removeEventListener("focusout", tableFocus);
        tableBody.removeEventListener("click", tableClick);
    }
    if (tableHeaders !== null) {
        tableHeaders.removeEventListener("click", headersClick);
    }
}

function deleteSection(tableId) {
    var tableForDeletion = docEl("table-headers-" + tableId).parentNode;
    var tableBody = docEl("table-body-" + tableId);
    var tableHeaders = docEl("table-headers-" + tableId);
    var resetbutton = docEl("hs-" + tableId);
    var deletebutton = docEl("hd-" + tableId);
    var renameOkbtn = docEl("hk-" + tableId);
    var renameExitbtn = docEl("hz-" + tableId);
    var renameSection = docEl("hn" + tableId);

    appEditor.table_Id = "";
    tableBody.removeEventListener("focusout", tableFocus);
    tableBody.removeEventListener("click", tableClick);
    tableHeaders.removeEventListener("click", headersClick);
    resetbutton.removeEventListener("click", resetBtn);
    deletebutton.removeEventListener("click", deletebutton);
    renameOkbtn.removeEventListener("click", renameOkbtn);
    renameExitbtn.removeEventListener("click", renameExitbtn);

    emptyContent(tableForDeletion);

    tableForDeletion.parentNode.removeChild(tableForDeletion);
    resetbutton.parentNode.removeChild(resetbutton);
    deletebutton.parentNode.removeChild(deletebutton);
    renameOkbtn.parentNode.removeChild(renameOkbtn);
    renameExitbtn.parentNode.removeChild(renameExitbtn);
    renameSection.parentNode.removeChild(renameSection);

    delete appEditor.tableObj[tableId];
    delete appEditor.table_lookup[tableId];
}

function createSpreadsheet(bool) {
    var tableId = "" + appEditor.table_Id;
    var spreadsheetData,
        defaultRowCount,
        defaultColCount,
        tableHeaderElement,
        tableBodyElement,
        tableBody,
        tableHeaders;

    if (bool === false) { removeOldListeners(tableId); }
    spreadsheetData = getData();
    defaultRowCount = spreadsheetData.length - 1;
    defaultColCount = spreadsheetData[0].length - 1;
    tableHeaderElement = docEl("table-headers-" + tableId);
    tableBodyElement = docEl("table-body-" + tableId);
    tableBody = tableBodyElement.cloneNode(true);
    tableBodyElement.parentNode.replaceChild(tableBody, tableBodyElement);
    tableHeaders = tableHeaderElement.cloneNode(true);
    tableHeaderElement.parentNode.replaceChild(tableHeaders, tableHeaderElement);

    emptyContent(tableHeaders);
    emptyContent(tableBody);

    tableHeaders.appendChild(createHeaderRow(defaultColCount));

    createTableBody(tableBody, defaultRowCount, defaultColCount);
    populateTable();

    tableBody.addEventListener("focusout", tableFocus);
    tableBody.addEventListener("click", tableClick);
    tableHeaders.addEventListener("click", headersClick);
    docEl("hr-1-1-" + appEditor.table_Id).textContent = appEditor.table_lookup[tableId];
}

//DOM PUNCHING

function createStudentEl(studentIndex, referenceObj) {
    var container = document.getElementById("editStudents_body");
    var frag = document.createDocumentFragment();
    var newTr = document.createElement("tr");
    var newTd1 = document.createElement("td");
    var newTd2 = document.createElement("td");
    var newTd3 = document.createElement("td");
    var newTd4 = document.createElement("td");
    var newSpan = document.createElement("span");
    var newInput1 = document.createElement("input");
    var newInput2 = document.createElement("input");
    var newInput3 = document.createElement("input");

    newTd1.className = "col-lg-4 col-md-4 col-sm-4 col-xs-4";
    newTd2.className = "col-lg-4 col-md-4 col-sm-4 col-xs-4";
    newTd3.className = "col-lg-4 col-md-4 col-sm-4 col-xs-4";
    newInput1.id = "yc" + studentIndex;
    newInput1.value = referenceObj.stCls;
    newInput2.id = "yf" + studentIndex;
    newInput2.value = referenceObj.stId;
    newInput3.id = "yn" + studentIndex;
    newInput3.value = referenceObj.stNme;
    newTd4.className = "col-width30 text-center";
    newSpan.id = "yd" + studentIndex;
    newSpan.className = "btn btn-xs btn-danger";
    newSpan.textContent = "\u2716";
    newTr.id = "yt" + studentIndex;

    newTd1.appendChild(newInput1);
    newTd2.appendChild(newInput2);
    newTd3.appendChild(newInput3);
    newTd4.appendChild(newSpan);
    newTr.appendChild(newTd1);
    newTr.appendChild(newTd2);
    newTr.appendChild(newTd3);
    newTr.appendChild(newTd4);
    frag.appendChild(newTr);
    container.appendChild(frag);
}

function createSnippetEl(objIndex, snptIndex, txt) {
    var container = docEl("snptsTbd");
    var frag = document.createDocumentFragment();
    var newDiv1 = document.createElement("div");
    var newDiv3 = document.createElement("div");
    var newTr = document.createElement("tr");
    var newTd1 = document.createElement("td");
    var newTd2 = document.createElement("td");
    var newTd3 = document.createElement("td");
    var newTd4 = document.createElement("td");
    var newSpan2 = document.createElement("span");
    var newSelect1 = document.createElement("select");
    var newSelect2 = document.createElement("select");
    var selectIid = "iu" + objIndex + "-" + snptIndex;
    //index of obj in appEditor.snippets, index of the snippet within the array of snippets of the obj, the content of the snippet
    newTr.id = "ii" + objIndex + "-" + snptIndex;
    newTd1.className = "text-center";
    newDiv1.className = "selectSnippet select-styleO";
    newSelect1.id = selectIid;
    //onchange Rubric dropdown: repopulate the Section select to show the corresponding sections for the rubric selected
    newSelect1.onchange = function(){ fireUpdateSingleTagSnippetSection(selectIid); };
    newTd2.className = "text-center";
    newDiv3.className = "selectSnippet select-styleO";
    newSelect2.id = "ia" + objIndex + "-" + snptIndex;
    newTd3.id = "ix" + objIndex + "-" + snptIndex;
    newTd3.contentEditable = "true";
    newTd3.textContent = txt;
    newTd4.className = "col-width30 text-center";
    newSpan2.id = "ie" + objIndex + "-"+ snptIndex;
    newSpan2.className = "btn btn-xs btn-danger";
    newSpan2.textContent = "\u2716";

    newDiv1.appendChild(newSelect1);
    newTd1.appendChild(newDiv1);
    newDiv3.appendChild(newSelect2);
    newTd2.appendChild(newDiv3);
    newTd4.appendChild(newSpan2);
    newTr.appendChild(newTd1);
    newTr.appendChild(newTd2);
    newTr.appendChild(newTd3);
    newTr.appendChild(newTd4);
    frag.appendChild(newTr);
    container.appendChild(frag);
}

function buildRecordsMap() {
    var clsses = allClasses();
    var frag = document.createDocumentFragment();
    var container = docEl("recordsMap");
    var stdnts;
    var aStdntRecords;
    var i;
    var ii;
    var iii;

    emptyContent(container);

    for (i = 0; i < clsses.length; i++) {
        var newDiv1 = document.createElement("div");
        var newDiv2 = document.createElement("div");
        var newTable1 = document.createElement("table");
        var newTbody1 = document.createElement("tbody");
        var newSpan0 = document.createElement("span");
        var newDelSpan = document.createElement("span");
        var newDlSpan = document.createElement("span");

        newSpan0.id = "jq" + i;
        newSpan0.className = "label label-md";
        newSpan0.style.fontWeight = 400;
        newSpan0.textContent = "Select all / none";
        newDelSpan.id = "jz" + i;
        newDelSpan.className = "btn btn-xs btn-dangerous destroyRecord pull-right";
        newDelSpan.style.marginLeft = 5 + "px";
        newDelSpan.textContent = "Delete selected";
        newDlSpan.id = "jx" + i;
        newDlSpan.className = "btn btn-xs btn-default pull-right";
        newDlSpan.textContent = "Download selected";
        newDlSpan.style.paddingLeft = 5 + "px";
        newDlSpan.style.paddingRight = 5 + "px";
        newDiv1.id = "jh" + i;
        newDiv1.className = "mapClass";
        newDiv1.textContent = "Class: " + clsses[i] + " ";
        newDiv2.id = "jm" + i;
        newTable1.className = "table small noBtmMargin";
        newTbody1.id = "jb" + i;

        stdnts = getCandidatesByClass(clsses[i]); //[["21526737","김채영"],["21526494","박주희"],...]

        for (ii = 0; ii < stdnts.length; ii++) {
            var newTr1 = document.createElement("tr");
            var newTd1 = document.createElement("td");
            var newDiv3 = document.createElement("div");

            newDiv3.id = "jy" + i + "-" + ii;
            newDiv3.dataset.cls = clsses[i];
            newDiv3.dataset.sid = stdnts[ii][0];
            newDiv3.dataset.nme = stdnts[ii][1];
            newDiv3.className = "btn btn-sm btn-whiteBlue";
            newDiv3.style.margin = 1 + "px";
            newDiv3.textContent = "Edit";
            newTr1.className = "striped";
            newTd1.appendChild(newDiv3);
            newTr1.appendChild(newTd1);

            aStdntRecords = getOneSetOfRecords(stdnts[ii][0],stdnts[ii][1], clsses[i]); //id, name, class

            if (!aStdntRecords.length) {
                continue; //ignore unfound records...
            } else {
                var newTd3 = document.createElement("td");
                var newSpan2 = document.createElement("span");

                newSpan2.id = "jw" + i + "-" + ii;
                newSpan2.dataset.cls = clsses[i];
                newSpan2.dataset.sid = stdnts[ii][0];
                newSpan2.dataset.nme = stdnts[ii][1];
                newSpan2.className = "label label-md";
                newSpan2.dataset.slct = "all";
                newSpan2.textContent = stdnts[ii][0] + " " + stdnts[ii][1]; //"Select all"
                newTd3.className = "tdSelectBtn";
                newTd3.appendChild(newSpan2);
                newTr1.appendChild(newTd3);

                for (iii = 0; iii < aStdntRecords.length; iii++) { //i: is the class, ii: is the student, iii: is the record
                    var recordDate = new Date(aStdntRecords[iii].timeStamp).toLocaleDateString();
                    var newTd2 = document.createElement("td");
                    var newDiv4 = document.createElement("div");
                    var newInput1 = document.createElement("input");
                    var newLabel1 = document.createElement("label");
                    var newSpan1 = document.createElement("span");
                    var recordId = "jk" + aStdntRecords[iii].recordKey;

                    newDiv4.className = "squaredFour compacted";
                    newInput1.type = "checkbox";
                    newInput1.id = recordId;
                    newInput1.className = "targeted";
                    newLabel1.htmlFor = recordId;
                    newSpan1.textContent = " " + aStdntRecords[iii].context + "\n" + recordDate;
                    newDiv4.appendChild(newInput1);
                    newDiv4.appendChild(newLabel1);
                    newTd2.appendChild(newDiv4);
                    newTd2.appendChild(newSpan1);
                    newTr1.appendChild(newTd2);
                }
                newTbody1.appendChild(newTr1);
            }
        }
        newDiv1.appendChild(newSpan0);
        newDiv1.appendChild(newDelSpan);
        newDiv1.appendChild(newDlSpan);
        newTable1.appendChild(newTbody1);
        newDiv2.appendChild(newTable1);
        frag.appendChild(newDiv1);
        frag.appendChild(newDiv2);
    }
    container.appendChild(frag);
}

function createFinalRecordElForNoRubric(recordIndex) {
    var container = docEl("recordsContainer");
    var frag = document.createDocumentFragment();
    var newDiv1 = document.createElement("div");
    var newDiv3 = document.createElement("div");
    var newDiv4 = document.createElement("div");
    var newDiv5 = document.createElement("div");
    var newDiv6 = document.createElement("div");
    var newDiv10 = document.createElement("div");
    var newDiv11 = document.createElement("div");
    var newDiv12 = document.createElement("div");
    var newDiv13 = document.createElement("div");
    var newDiv14 = document.createElement("div");
    var newDiv15 = document.createElement("div");
    var newDiv17 = document.createElement("div");
    var newInput2 = document.createElement("input");
    var newInput3 = document.createElement("input");
    var newSpan4 = document.createElement("span");
    var newInput1 = document.createElement("input");
    var newSpan2 = document.createElement("span");
    var newSpan3 = document.createElement("span");
    var dateTime = new Date(appEditor.appEditRecords.tempStudentRecords[recordIndex].timeStamp).toLocaleString();
    var newSpanRubric1 = document.createElement("span");
    var newDivRubric1 = document.createElement("div");
    var newDivRubric3 = document.createElement("div");
    var newDivRubric4 = document.createElement("div");
    var newDivRubric5 = document.createElement("div");

    newDiv14.className = "col-lg-3 col-md-3 col-sm-3 col-xs-6 fbkSection";
    newDiv15.className = "feedbackLabel text-center";
    newDiv15.textContent = "Score";
    newDiv17.className = "text-center";
    newInput2.type = "number";
    newInput2.id = "ts" + recordIndex;
    newInput2.className = "genTotalScore";
    newInput2.value = appEditor.appEditRecords.tempStudentRecords[recordIndex].noRubricScore.scr;
    newSpan4.textContent = " / ";
    newInput3.type = "number";
    newInput3.id = "tm" + recordIndex;
    newInput3.className = "genTotalScore";
    newInput3.value = appEditor.appEditRecords.tempStudentRecords[recordIndex].noRubricScore.max;
    newDiv1.id = "fh" + recordIndex;
    newDiv1.className = "row";
    newDiv3.className = "col-lg-12 recordWrapper";
    newDiv4.className = "row";
    newDiv5.className = "col-lg-12";
    newDiv6.id = "fuSection" + recordIndex;
    newDiv10.className = "row";
    newDiv10.style.marginLeft = 0;
    newDiv10.style.marginRight = 0;
    newDiv11.className = "col-lg-9 col-md-9 col-sm-9 fbkSection";
    newDiv12.className = "feedbackLabel";
    newDiv12.textContent = "General feedback";
    newDiv13.id="opt1_" + recordIndex;
    newDiv13.contentEditable = "true";
    newDiv13.className = "fbkA commentBtnA";
    newInput1.id = "fc" + recordIndex;
    newInput1.className = "inputContext";
    newInput1.value = appEditor.appEditRecords.tempStudentRecords[recordIndex].context;
    newSpan2.textContent = dateTime;
    newSpan2.className = "btn-xs pull-right";
    newSpan3.id = "fx" + recordIndex + "-0";
    newSpan3.className = "btn btn-xs btn-dangerous pull-right destroyRecord";
    newSpan3.textContent = "Delete Record";
    newDivRubric1.id = "fq" + recordIndex;
    newDivRubric1.className = "row nodisplay";
    newDivRubric3.className = "col-lg-12 recordWrapper";
    newDivRubric4.className = "row text-center";
    newDivRubric4.style.marginBottom = 5 + "px";
    newDivRubric4.textContent = "Rubric for " + appEditor.appEditRecords.tempStudentRecords[recordIndex].context + " - " + dateTime + " ";
    newDivRubric5.id = "frrA" + recordIndex;
    newDivRubric5.className = "row small";
    newSpanRubric1.id = "fw" + recordIndex;
    newSpanRubric1.className = "btn btn-sm btn-default";
    newSpanRubric1.textContent = "Back to record";

    newDiv17.appendChild(newInput2);
    newDiv17.appendChild(newSpan4);
    newDiv17.appendChild(newInput3);
    newDiv11.appendChild(newDiv12);
    newDiv11.appendChild(newDiv13);
    newDiv14.appendChild(newDiv15);
    newDiv14.appendChild(newDiv17);
    newDiv10.appendChild(newDiv11);
    newDiv10.appendChild(newDiv14);
    newDiv5.appendChild(newInput1);
    newDiv5.appendChild(newSpan3);
    newDiv5.appendChild(newSpan2);
    newDiv4.appendChild(newDiv5);
    newDiv3.appendChild(newDiv4);
    newDiv3.appendChild(newDiv6);
    newDiv3.appendChild(newDiv10);
    newDiv1.appendChild(newDiv3);
    frag.appendChild(newDiv1);
    newDivRubric4.appendChild(newSpanRubric1);
    newDivRubric3.appendChild(newDivRubric4);
    newDivRubric3.appendChild(newDivRubric5);
    newDivRubric1.appendChild(newDivRubric3);
    frag.appendChild(newDivRubric1);
    container.appendChild(frag);

    setRecordFeedbck(recordIndex);
}

function createFinalRecordEl(recordIndex) {
    var container = docEl("recordsContainer");
    var frag = document.createDocumentFragment();
    var newDiv1 = document.createElement("div");
    var newDiv3 = document.createElement("div");
    var newDiv4 = document.createElement("div");
    var newDiv5 = document.createElement("div");
    var newDiv6 = document.createElement("div");
    var newDiv10 = document.createElement("div");
    var newDiv11 = document.createElement("div");
    var newDiv12 = document.createElement("div");
    var newDiv13 = document.createElement("div");
    var newDiv14 = document.createElement("div");
    var newDiv15 = document.createElement("div");
    var newDiv17 = document.createElement("div");
    var newInput1 = document.createElement("input");
    var newSpan2 = document.createElement("span");
    var newSpan3 = document.createElement("span");
    var dateTime = new Date(appEditor.appEditRecords.tempStudentRecords[recordIndex].timeStamp).toLocaleString();
    var newDiv22 = document.createElement("div");
    var newDiv23 = document.createElement("div");
    var newLabel2 = document.createElement("label");
    var newInput2 = document.createElement("input");
    var newSpan4 = document.createElement("span");
    var newSpanRubric1 = document.createElement("span");
    var newDivRubric1 = document.createElement("div");
    var newDivRubric3 = document.createElement("div");
    var newDivRubric4 = document.createElement("div");
    var newDivRubric5 = document.createElement("div");

    newDiv14.className = "col-lg-3 col-md-3 col-sm-3 col-xs-6 fbkSection";
    newDiv15.className = "feedbackLabel text-center";
    newDiv15.textContent = "Rubric";
    newDiv17.className = "text-center";
    newDiv22.className = "squaredFour";
    newDiv22.style.display = "inline-block";
    newInput2.type = "checkbox";
    newInput2.id = "opt2_" + recordIndex;
    newInput2.value = "nada";
    newInput2.checked = appEditor.appEditRecords.tempStudentRecords[recordIndex].feedback.rubricChkd;
    newLabel2.htmlFor = "opt2_" + recordIndex;
    newSpan4.className = "small";
    newSpan4.textContent = "Include";
    newDiv23.id = "fv" + recordIndex;
    newDiv23.className = "small btn btn-sm btn-default rubricViewer";
    newDiv23.style.marginLeft = 10 + "px";
    newDiv23.textContent = "View rubric";
    newDiv22.appendChild(newInput2);
    newDiv22.appendChild(newLabel2);
    newDiv17.appendChild(newDiv22);
    newDiv17.appendChild(newSpan4);
    newDiv17.appendChild(newDiv23);
    newDiv1.id = "fh" + recordIndex;
    newDiv1.className = "row";
    newDiv3.className = "col-lg-12 recordWrapper";
    newDiv4.className = "row";
    newDiv5.className = "col-lg-12";
    newDiv6.id = "fuSection" + recordIndex;
    newDiv10.className = "row";
    newDiv10.style.marginLeft = 0;
    newDiv10.style.marginRight = 0;
    newDiv11.className = "col-lg-9 col-md-9 col-sm-9 fbkSection";
    newDiv12.className = "feedbackLabel";
    newDiv12.textContent = "General feedback";
    newDiv13.id="opt1_" + recordIndex;
    newDiv13.contentEditable = "true";
    newDiv13.className = "fbkA commentBtnA";
    newInput1.id = "fc" + recordIndex;
    newInput1.className = "inputContext";
    newInput1.value = appEditor.appEditRecords.tempStudentRecords[recordIndex].context;
    newSpan2.textContent = dateTime;
    newSpan2.className = "btn-xs pull-right";
    newSpan3.id = "fx" + recordIndex + "-0";
    newSpan3.className = "btn btn-xs btn-dangerous pull-right destroyRecord";
    newSpan3.textContent = "Delete Record";
    newDivRubric1.id = "fq" + recordIndex;
    newDivRubric1.className = "row nodisplay";
    newDivRubric3.className = "col-lg-12 recordWrapper";
    newDivRubric4.className = "row text-center";
    newDivRubric4.style.marginBottom = 5 + "px";
    newDivRubric4.textContent = "Rubric for " + appEditor.appEditRecords.tempStudentRecords[recordIndex].context + " - " + dateTime + " ";
    newDivRubric5.id = "frrA" + recordIndex;
    newDivRubric5.className = "row small";
    newSpanRubric1.id = "fw" + recordIndex;
    newSpanRubric1.className = "btn btn-sm btn-default";
    newSpanRubric1.textContent = "Back to record";

    newDiv11.appendChild(newDiv12);
    newDiv11.appendChild(newDiv13);
    newDiv14.appendChild(newDiv15);
    newDiv14.appendChild(newDiv17);
    newDiv10.appendChild(newDiv11);
    newDiv10.appendChild(newDiv14);
    newDiv5.appendChild(newInput1);
    newDiv5.appendChild(newSpan3);
    newDiv5.appendChild(newSpan2);
    newDiv4.appendChild(newDiv5);
    newDiv3.appendChild(newDiv4);
    newDiv3.appendChild(newDiv6);
    newDiv3.appendChild(newDiv10);
    newDiv1.appendChild(newDiv3);
    frag.appendChild(newDiv1);
    newDivRubric4.appendChild(newSpanRubric1);
    newDivRubric3.appendChild(newDivRubric4);
    newDivRubric3.appendChild(newDivRubric5);
    newDivRubric1.appendChild(newDivRubric3);
    frag.appendChild(newDivRubric1);
    container.appendChild(frag);

    setRecordFeedbck(recordIndex);
    setRecordRubric(recordIndex);
}

function createFinalRecordSectionEl(recordIndex, sectionName, sectionIndex) {
    var container = docEl("fuSection" + recordIndex);
    var frag = document.createDocumentFragment();
    var newDiv0 = document.createElement("div");
    var newDiv1 = document.createElement("div");
    var newSpan1 = document.createElement("span");
    var newInput = document.createElement("input");
    var newTable = document.createElement("table");
    var newThead = document.createElement("thead");
    var newTr = document.createElement("tr");
    var newTh1 = document.createElement("th");
    var newTh2 = document.createElement("th");
    var newTh3 = document.createElement("th");
    var newTh4 = document.createElement("th");
    var newTbody = document.createElement("tbody");

    newDiv0.id = "fu" + recordIndex + "-" + sectionIndex;
    newDiv0.style.marginBottom = 10 + "px";
    newDiv1.style.marginBottom = 5 + "px";
    newSpan1.textContent = "Section: ";
    newInput.id = "opt4_" + recordIndex + "_" + sectionIndex;
    newInput.className = "finalRecordSection";
    newInput.value = sectionName;
    newTable.className = "table table-condensed table-bordered";
    newTable.style.marginBottom = 5 + "px";
    newThead.className = "text-center tableHeader";
    newTh1.className = "col-width120";
    newTh1.textContent = "Criteria";
    newTh2.className = "col-width50";
    newTh2.textContent = "Score";
    newTh3.className = "col-width50";
    newTh3.textContent = "Max.";
    newTh4.className = "col-lg-6 col-md-6 col-sm-6";
    newTh4.textContent = "Descriptor";
    newTbody.id = "ff" + recordIndex + "-" + sectionIndex;

    newDiv1.appendChild(newSpan1);
    newDiv1.appendChild(newInput);
    newTr.appendChild(newTh1);
    newTr.appendChild(newTh2);
    newTr.appendChild(newTh3);
    newTr.appendChild(newTh4);
    newThead.appendChild(newTr);
    newTable.appendChild(newThead);
    newTable.appendChild(newTbody);
    newDiv0.appendChild(newDiv1);
    newDiv0.appendChild(newTable);
    frag.appendChild(newDiv0);
    container.appendChild(frag);
}

function createFinalRecordCriteriasEl(recordIndex, sectionIndex) { //creates one row (tr) for each criteria of a section
    var container = docEl("ff" + recordIndex + "-" + sectionIndex);
    var frag = document.createDocumentFragment();
    var allCriterias = appEditor.appEditRecords.tempStudentRecords[recordIndex].scores[sectionIndex];
    var allCriteriasLength = allCriterias.length;
    var newTr2 = document.createElement("tr"); //the section comment...
    var newTd6 = document.createElement("td");
    var newTd7 = document.createElement("td");
    var i,
        ii;

    for (i = 0; i < allCriteriasLength; i++) {
        var newTr = document.createElement("tr");
        var newTd1 = document.createElement("td");
        var newTd2 = document.createElement("td");
        var newTd3 = document.createElement("td");
        var newTd4 = document.createElement("td");
        var criteriaId = "ff" + recordIndex + "-" + sectionIndex + "-" + i + "-";
        var newDiv2 = document.createElement("div");
        var newSelect1 = document.createElement("select");
        var criteriaRange = appEditor.appEditRecords.tempStudentRecords[recordIndex].feedback.rubric[sectionIndex].sectionDef[i].criteriaDef;
        var scoreRange = criteriaRange.map( function(el) { return el.score; });
        var scoreRangeLen = scoreRange.length;

        //newTd1.id = criteriaId + "0";
        newTd1.textContent = allCriterias[i][0]; //[sectionIndex][criteriaIndex][criteria, score, max., descriptor]
        newDiv2.className = "selectScore select-styleO";
        newSelect1.id = criteriaId + "1";

        for (ii = 0; ii < scoreRangeLen; ii++) {
            var newOpt = document.createElement("option");

            newOpt.value = scoreRange[ii];
            newOpt.textContent = scoreRange[ii];

            if (scoreRange[ii] === allCriterias[i][1]) { newOpt.selected = true; }
            newSelect1.appendChild(newOpt);
        }
        //newTd3.id = criteriaId + "2";
        newTd3.textContent = allCriterias[i][2];
        newTd4.id = criteriaId + "3";
        newTd4.textContent = allCriterias[i][3];

        newDiv2.appendChild(newSelect1);
        newTd2.appendChild(newDiv2);
        newTr.appendChild(newTd1);
        newTr.appendChild(newTd2);
        newTr.appendChild(newTd3);
        newTr.appendChild(newTd4);
        frag.appendChild(newTr);
    }
    newTd6.textContent = "Comment:";
    newTd7.id = "opt3_" + recordIndex + "_" + sectionIndex;
    newTd7.contentEditable = "true";
    newTd7.textContent = appEditor.appEditRecords.tempStudentRecords[recordIndex].comments[sectionIndex];
    newTd7.colSpan = "3";
    newTr2.appendChild(newTd6);
    newTr2.appendChild(newTd7);
    frag.appendChild(newTr2);
    container.appendChild(frag);
}

function createFinalRecord() {
    var rubricChkd = docEl("gRbChkd").checked;
    var finalRecord = {};
    var recordVal,
        genScore,
        i,
        ii;

    finalRecord.timeStamp = Date.now();
    finalRecord.context = appEditor.grader.tempRecord.context;
    finalRecord.feedback = {};
    finalRecord.feedback.written = appEditor.grader.tempRecord.feedback.written;
    finalRecord.feedback.rubric = appEditor.grader.rubric;
    finalRecord.feedback.rubricChkd = rubricChkd;
    finalRecord.studentData = {};
    finalRecord.studentData.stCls = appEditor.grader.tempRecord.class;
    finalRecord.studentData.stId = appEditor.grader.tempRecord.ssId;
    finalRecord.studentData.stNme = appEditor.grader.tempRecord.ssName;

    if (appEditor.grader.noRubricCommentsOnly === true) {
        finalRecord.noRubric = true;
        finalRecord.noRubricScore = {};
        genScore = getGenScoreForNoRubric("gOvrllScr", "gOvrllMax");
        finalRecord.noRubricScore.scr = genScore[0];
        finalRecord.noRubricScore.max = genScore[1];
    } else {
        finalRecord.comments = [];
        finalRecord.sectionNames = [];
        finalRecord.scores = [];
        finalRecord.sectionNames = appEditor.grader.tempRecord.sectionNames;

        for ( i = 0; i < appEditor.grader.tempRecord.scores.length; i++ ) {
            finalRecord.comments.push(appEditor.grader.tempRecord.comments[i]);
            finalRecord.scores.push([]);

            for ( ii = 0; ii < appEditor.grader.tempRecord.scores[i].length; ii++ ) {
                recordVal = getTempRecordVariables(i, ii);
                finalRecord.scores[i].push([]);
                finalRecord.scores[i][ii].push(recordVal.criteria);
                finalRecord.scores[i][ii].push(recordVal.score);
                finalRecord.scores[i][ii].push(recordVal.maxScore); //@findMaxScore
                finalRecord.scores[i][ii].push(recordVal.descriptor);
            }
        }
    }
    return finalRecord;
}

function buildStudentgMap() {
    var clsses = allgClasses();
    var frag = document.createDocumentFragment();
    var container = docEl("mgap");
    var stdnts,
        i,
        ii;

    emptyContent(container);

    for (i = 0; i < clsses.length; i++) {
        var newDiv1 = document.createElement("div");
        var newDiv2 = document.createElement("div");

        newDiv1.id = "gh" + i;
        newDiv1.textContent = "Class: " + clsses[i];
        newDiv1.className = "mapClass";
        stdnts = getgCandidatesByClass(clsses[i]);

        for (ii = 0; ii < stdnts.length; ii++) {
            var newBtn1 = document.createElement("div");

            newBtn1.id = "gy" + i + "-" + ii;
            newBtn1.dataset.cls = clsses[i];
            newBtn1.dataset.sid = stdnts[ii][0];
            newBtn1.dataset.nme = stdnts[ii][1];
            newBtn1.className = "btn btn-sm btn-inline btn-default";
            newBtn1.style.margin = 1 + "px";
            newBtn1.textContent = stdnts[ii][0] + " " + stdnts[ii][1];
            newDiv2.appendChild(newBtn1);
        }
        newDiv2.id = "gb" + i;
        frag.appendChild(newDiv1);
        frag.appendChild(newDiv2);
    }
    container.appendChild(frag);
}

function populateAllgClassesSelectBox() {
    var clsses = allgClasses();
    var selectId = docEl("chooseClass");
    var frag = document.createDocumentFragment();
    var newOpt0 = document.createElement("option");
    var i;

    newOpt0.value = "";
    newOpt0.textContent = "Class";
    frag.appendChild(newOpt0);

    for (i = 0; i < clsses.length; i++) {
        var newOpt1 = document.createElement("option");

        newOpt1.value = clsses[i];
        newOpt1.textContent = clsses[i];
        frag.appendChild(newOpt1);
    }
    emptyContent(selectId);
    selectId.appendChild(frag);
    selectId.firstChild.setAttribute("disabled", true);
    selectId.firstChild.setAttribute("selected", true);
}

function populateStudentsByClass(clss, bool) {
    var stdnts = getgCandidatesByClass(clss);
    var selectId = docEl("chooseId");
    var frag = document.createDocumentFragment();
    var newOpt0 = document.createElement("option");
    var i;

    newOpt0.value = "";
    newOpt0.dataset.nme = "";
    newOpt0.textContent = "Student";
    frag.appendChild(newOpt0);

    for (i = 0; i < stdnts.length; i++) {
        var newOpt1 = document.createElement("option");

        newOpt1.value = stdnts[i][0];
        newOpt1.dataset.nme = stdnts[i][1];
        newOpt1.textContent = stdnts[i][0] + " " + stdnts[i][1];
        frag.appendChild(newOpt1);
    }
    emptyContent(selectId);
    selectId.appendChild(frag);
    selectId.firstChild.setAttribute("disabled", true);

    if (bool === false) { selectId.firstChild.setAttribute("selected", true); }
}

function createGradingSnippetEl(snippetIndex, txt) {
    var container = docEl("snpptgContainer");
    var frag = document.createDocumentFragment();
    var newDiv1 = document.createElement("div");
    var newDiv2 = document.createElement("div");
    var newTr = document.createElement("tr");
    var newTd1 = document.createElement("td");
    var newTd2 = document.createElement("td");
    var newTd3 = document.createElement("td");
    var newSpan1 = document.createElement("span");
    var newInput = document.createElement("input");
    var newLabel = document.createElement("label");
    var newTag = document.createElement("span");

    newTd1.className = "text-center";
    newSpan1.id = "gn" + snippetIndex;
    newSpan1.className = "helperNum";
    newDiv2.className = "squaredFour snpptChkbx";
    newInput.type = "checkbox";
    newInput.id = "gc" + snippetIndex;
    newLabel.htmlFor = "gc" + snippetIndex;
    newTd2.className = "text-center";
    newTag.id = "gt" + snippetIndex;
    newTag.className = "small";
    newTd3.id = "gx" + snippetIndex;
    newTd3.textContent = txt;

    newDiv2.appendChild(newInput);
    newDiv2.appendChild(newLabel);
    newDiv1.appendChild(newSpan1);
    newDiv1.appendChild(newDiv2);
    newTd1.appendChild(newDiv1);
    newTd2.appendChild(newTag);
    newTr.appendChild(newTd1);
    newTr.appendChild(newTd2);
    newTr.appendChild(newTd3);
    frag.appendChild(newTr);
    container.appendChild(frag);

    createTagsForSnippets(snippetIndex);
}

function createGradingRubriksButtons(rubrikKey, rubrikName) {
    var container = docEl("gaLoadChkBoxes"); //fieldset
    var frag = document.createDocumentFragment();
    var newInput = document.createElement("input");
    var newLabel = document.createElement("label");

    newInput.id = "gr" + rubrikKey;
    newInput.value = rubrikName;
    newInput.name = "scalot";
    newInput.type = "radio";
    newLabel.htmlFor = "gr" + rubrikKey;
    newLabel.textContent = rubrikName;

    frag.appendChild(newInput);
    frag.appendChild(newLabel);
    container.appendChild(frag);
}

function createNoRubricGradingRubrikButton() {
    var container = docEl("gaLoadChkBoxes"); //fieldset
    var frag = document.createDocumentFragment();
    var newInput = document.createElement("input");
    var newLabel = document.createElement("label");

    newInput.id = "_sanz_rubrik";
    newInput.value = "No rubric";
    newInput.name = "scalot";
    newInput.type = "radio";
    newLabel.htmlFor = "_sanz_rubrik";
    newLabel.textContent = "No rubric";

    frag.appendChild(newInput);
    frag.appendChild(newLabel);
    container.appendChild(frag);
}

function setUpChkbxSections(bool) {
    var frag,
        allSectionNames,
        i;

    docEl("gaSctnTextHelper").textContent = "";
    emptyContent(docEl('gaCbContainer'));

    if (bool !== true) { return; }

    frag = document.createDocumentFragment();
    allSectionNames = getSectionNames(appEditor.grader.rubricFilter);

    for (i = 0; i < allSectionNames.length; i++) {
        var newDiv1 = document.createElement("div");
        var newDiv2 = document.createElement("div");
        var gnumDiv = document.createElement("div");
        var newInput1 = document.createElement("input");
        var newLabel1 = document.createElement("label");
        var newSpan1 = document.createElement("span");

        newDiv2.className = "squaredFour";
        gnumDiv.id = "gs" + i;
        gnumDiv.className = "helperNum";
        newInput1.type = "checkbox";
        newInput1.id = "gw" + (i+1);
        newInput1.value = i;
        newInput1.checked = false;
        newLabel1.htmlFor = "gw" + (i+1);
        newSpan1.textContent = allSectionNames[i];
        newDiv1.appendChild(gnumDiv);
        newDiv2.appendChild(newInput1);
        newDiv2.appendChild(newLabel1);
        newDiv1.appendChild(newDiv2);
        newDiv1.appendChild(newSpan1);
        frag.appendChild(newDiv1);
    }
    docEl("gaSctnTextHelper").textContent = "...and the sections to use (in order):";
    docEl('gaCbContainer').appendChild(frag);
}

function createGradingCriteriasEl(sectionIndex) { //creates one row (tr) for each criteria of a section
    var container = docEl("gf" + sectionIndex);
    var frag = document.createDocumentFragment();
    var allCriterias = appEditor.grader.rubric[sectionIndex].sectionDef;
    var allCriteriasLength = allCriterias.length;
    var newTr2 = document.createElement("tr"); //the section comment...
    var newTd6 = document.createElement("td");
    var newTd7 = document.createElement("td");
    var newPasteSpan = document.createElement("span");
    var i,
        ii;

    for (i = 0; i < allCriteriasLength; i++) {
        var newTr = document.createElement("tr");
        var newTd1 = document.createElement("td");
        var newTd2 = document.createElement("td");
        var newTd3 = document.createElement("td");
        var newTd4 = document.createElement("td");
        var criteriaId = "gf" + sectionIndex + "-" + i + "-";
        var newDiv2 = document.createElement("div");
        var newSelect1 = document.createElement("select");
        var criteriaRange = allCriterias[i].criteriaDef;
        var scoreRange = criteriaRange.map( function(el) { return el.score; }).sort( function(a,b){ return a < b; });
        var scoreRangeLen = scoreRange.length;
        var maxScore = scoreRange[scoreRangeLen - 1];
        var newFirstOpt = document.createElement("option"); //placeholder @selectedIndex = 0

        newTd1.id = criteriaId + "0";
        newTd1.textContent = allCriterias[i].criteriaName;
        newDiv2.className = "selectScore select-styleO";
        newSelect1.id = criteriaId + "1";
        newFirstOpt.value = "";
        newFirstOpt.textContent = "-";
        newFirstOpt.selected = true;
        newSelect1.appendChild(newFirstOpt);

        for (ii = 0; ii < scoreRangeLen; ii++) {
            var newOpt = document.createElement("option");

            newOpt.value = scoreRange[ii];
            newOpt.textContent = scoreRange[ii];
            newSelect1.appendChild(newOpt);
        }
        newTd3.id = criteriaId + "2";
        newTd3.textContent = maxScore;
        newTd4.id = criteriaId + "3";
        newTd4.textContent = ""; //default @ newOpt.selected

        newDiv2.appendChild(newSelect1);
        newTd2.appendChild(newDiv2);
        newTr.appendChild(newTd1);
        newTr.appendChild(newTd2);
        newTr.appendChild(newTd3);
        newTr.appendChild(newTd4);
        frag.appendChild(newTr);
    }
    newTd6.textContent = "Comment:";
    newPasteSpan.id = "gp" + sectionIndex;
    newPasteSpan.className = "icon-paste pasteBtn";
    newTd7.id = "gk" + sectionIndex;
    newTd7.contentEditable = "true";
    newTd7.textContent = "";
    newTd7.colSpan = "3";

    newTd6.appendChild(newPasteSpan);
    newTr2.appendChild(newTd6);
    newTr2.appendChild(newTd7);
    frag.appendChild(newTr2);
    container.appendChild(frag);
}

function createSectionElTables(i) {
    var container = docEl("gq" + i);
    var frag = document.createDocumentFragment();
    var newTable = document.createElement("table");
    var newThead = document.createElement("thead");
    var newTr = document.createElement("tr");
    var newTh1 = document.createElement("th");
    var newTh2 = document.createElement("th");
    var newTh3 = document.createElement("th");
    var newTh4 = document.createElement("th");
    var newTbody = document.createElement("tbody");

    newTable.className = "table table-condensed table-bordered";
    newTable.style.marginBottom = 5 + "px";
    newThead.className = "text-center tableHeader";
    newTh1.className = "col-width120";
    newTh1.textContent = "Criteria";
    newTh2.className = "col-width50";
    newTh2.textContent = "Score";
    newTh3.className = "col-width50";
    newTh3.textContent = "Max.";
    newTh4.className = "col-lg-6 col-md-6 col-sm-6";
    newTh4.textContent = "Descriptor";
    newTbody.id = "gf" + i;

    newTr.appendChild(newTh1);
    newTr.appendChild(newTh2);
    newTr.appendChild(newTh3);
    newTr.appendChild(newTh4);
    newThead.appendChild(newTr);
    newTable.appendChild(newThead);
    newTable.appendChild(newTbody);
    frag.appendChild(newTable);
    container.appendChild(frag);
}

function createUISections() {
    emptyContent(docEl('datgEntry'));
    var i;
    var frag = document.createDocumentFragment();

    for (i = 0; i < appEditor.grader.rubric.length; i++) { //each section wrapper
        var newDiv2 = document.createElement("div"); //locked section preview
        var newDiv3 = document.createElement("div");
        var newDiv4 = document.createElement("div");
        var newDiv5 = document.createElement("div");
        var newDiv6 = document.createElement("div");
        var newDiv7 = document.createElement("div");
        var newDiv5a = document.createElement("div");
        var newDiv6a = document.createElement("div");
        var newDiv15 = document.createElement("div");
        var newDiv16 = document.createElement("div");
        var newDiv17 = document.createElement("div");

        newDiv2.className = "row";
        newDiv3.className = "col-lg-12 wrapTextPreline";
        newDiv3.id = "gv" + i;
        newDiv5.className = "row";
        newDiv6.className = "col-lg-12 sectionLabel";
        newDiv6.textContent = appEditor.grader.rubric[i].sectionName;
        newDiv7.id = "gq" + i;
        newDiv7.className = "row";
        newDiv5a.className = "row";
        newDiv6a.className = "col-lg-12";
        newDiv15.className = "row";
        newDiv16.className = "col-lg-12 text-center";
        newDiv17.id = "gj" + i;
        newDiv17.className = "btn btn-sm btn-primary commitBtn icon-lock-open";
        newDiv17.textContent = "";

        newDiv5a.appendChild(newDiv6a);
        newDiv5.appendChild(newDiv6);
        newDiv4.appendChild(newDiv5);
        newDiv4.appendChild(newDiv5a);
        newDiv4.appendChild(newDiv7);
        newDiv2.appendChild(newDiv3);
        newDiv4.appendChild(newDiv2);
        newDiv16.appendChild(newDiv17);
        newDiv15.appendChild(newDiv16);
        newDiv4.appendChild(newDiv15);
        frag.appendChild(newDiv4);
    }
    docEl('datgEntry').appendChild(frag);
}

function populateFullRubric() {
    var numOfTables = appEditor.grader.rubric.length;
    var container = docEl("gaFullRbContainer");
    var frag = document.createDocumentFragment();
    var numOfRows,
        numOfCells,
        i,
        ii,
        iii;

    emptyContent(container);

    for (i = 0; i < numOfTables; i++) {
        var newTable = document.createElement("table");
        var newThead = document.createElement("thead");
        var newHeadTr = document.createElement("tr");
        var newTbody = document.createElement("tbody");
        var isRowStart;
        var isFirstRow;
        var isColStart;

        newTable.className = "table table-responsive table-striped table-bordered table-condensed";
        numOfRows = appEditor.grader.rubric[i].sectionDef.length;
        isRowStart = true;
        isFirstRow = true;

        for (ii = 0; ii < numOfRows; ii++) { //header row
            numOfCells = appEditor.grader.rubric[i].sectionDef[ii].criteriaDef.length;

            for (iii = 0; iii < numOfCells; iii++) {
                var newTh = document.createElement("th");

                if (isFirstRow === true) { //define the first row
                    if (isRowStart === true) {
                        var newCol1Th = document.createElement("th");

                        newCol1Th.textContent = appEditor.grader.rubric[i].sectionName;
                        newHeadTr.appendChild(newCol1Th);
                        isRowStart = false;
                    }
                    newTh.textContent = appEditor.grader.rubric[i].sectionDef[ii].criteriaDef[iii].score;
                    newHeadTr.appendChild(newTh);
                }
            }
            isFirstRow = false;
        }
        newThead.appendChild(newHeadTr);

        for (ii = 0; ii < numOfRows; ii++) { //body
            var newTr = document.createElement("tr");

            numOfCells = appEditor.grader.rubric[i].sectionDef[ii].criteriaDef.length;
            isColStart = true;

            for (iii = 0; iii < numOfCells; iii++) {
                var newTd = document.createElement("td");

                if (isColStart === true) { //define the first cell (criteria name)
                    var newCol1 = document.createElement("td");

                    newCol1.textContent = appEditor.grader.rubric[i].sectionDef[ii].criteriaName;
                    newTr.appendChild(newCol1);
                    isColStart = false;
                }
                newTd.textContent = appEditor.grader.rubric[i].sectionDef[ii].criteriaDef[iii].descriptor;
                newTr.appendChild(newTd);
            }
            newTbody.appendChild(newTr);
        }
        newTable.appendChild(newThead);
        newTable.appendChild(newTbody);
        frag.appendChild(newTable);
    }
    container.appendChild(frag);
}

function buildWelcomeMsg(name, bool) {
    var container = docEl("welcomeMsg");
    var frag = document.createDocumentFragment();
    var newDiv0 = document.createElement("DIV");
    var newDiv1 = document.createElement("DIV");
    var newH2 = document.createElement("H2");
    var newP = document.createElement("P");

    newDiv0.className = "row contentBox";
    newDiv0.style.marginTop = 80 + "px";
    newDiv1.className = "col-lg-12 text-left";

    if (bool === false) {
        newH2.textContent = "Access denied";
        newP.textContent = "Hello " + name + "! If you are known to us, access will be granted explicitly.";
    }
    if (bool === true) {
        newH2.textContent = "Hello " + name;
        newP.textContent = "Please use the menu buttons to get started.";
    }
    newDiv1.appendChild(newH2);
    newDiv1.appendChild(newP);
    newDiv0.appendChild(newDiv1);
    frag.appendChild(newDiv0);
    container.appendChild(frag);
}

function createAvailableRubriksButtons(rubrikNameKey, bool) {
    var container = docEl("ruLoadChkBoxes"); //fieldset
    var frag = document.createDocumentFragment();
    var newInput = document.createElement("input");
    var newLabel = document.createElement("label");

    newInput.id = "ruSelect_" + rubrikNameKey;
    newInput.value = rubrikNameKey;
    newInput.name = "scalor";
    newInput.type = "radio";
    newLabel.htmlFor = "ruSelect_" + rubrikNameKey;

    if (bool !== true) {
        newInput.dataset.share = true;
        newLabel.className = "shared";
        newLabel.textContent = appEditor.sharedRubricsIndex[rubrikNameKey].rubricName + " (shared)";
        newLabel.style.color = "#337ab7";
    } else {
        newLabel.textContent = appEditor.rubricsIndex[rubrikNameKey].rubricName;
    }
    frag.appendChild(newInput);
    frag.appendChild(newLabel);
    container.appendChild(frag);
}

function createAvailableRubriksDivider() {
    var container = docEl("ruLoadChkBoxes"); //fieldset
    var frag = document.createDocumentFragment();
    var newDiv0 = document.createElement("DIV");

    newDiv0.className = "rubricsDivider";

    frag.appendChild(newDiv0);
    container.appendChild(frag);
}

    // window.addEventListener('load', function() {
        firebase.auth().onAuthStateChanged(function(user) {
            if (user) {
                docEl("usrPhoto").src = user.photoURL;
                initApp();
                return;
            }
            window.location = "../index.html";
        });
    // });
})();
});