window.addEventListener('load', function() {
(function(){
 "use strict";

var appEditor = {
    users:{
        current:{},
        pending:{},
        removed:{},
        absentPending:{}
    },
    table_Id: "",
    table_lookup: {},
    tableObj: {},
    sharedRubricsIndex: {},
    appEditRecords: {
        loadedRubric: []
    },
    editorIsOpen: {
        rubric: false
    },
    db: {
        rubrics: false
    }
};

function chkPermission(e) {
    if (e.code === "PERMISSION_DENIED"){
        signOutOfApp();
    }
}

function signOutOfApp() {
    firebase.auth().signOut(); //thus prompting the authState observer...
}

function docEl(id) {
    return document.getElementById(id);
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

function emptyContent(parentEl) {
    while (parentEl.hasChildNodes()) {
        while (parentEl.lastChild.hasChildNodes()) {
            parentEl.lastChild.removeChild(parentEl.lastChild.lastChild);
        }
        parentEl.removeChild(parentEl.lastChild);
    }
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

function displayMsg(num, eStr) { //ERROR DISPLAY
    var msgArr = {
        c: "" + eStr,
        d: "Rubric could not be created.\n" + eStr,
        e: "Rubric successfully saved!",
        f: "Please select an existing rubric to load.",
        g: "A section with that name already exists!"
    };
    var msg = msgArr[num] || "Error.";

    window.mscAlert({
        title: "",
        subtitle: msg
    });
}

//MANAGE USERS

function chkForOpts() {
    firebase.database().ref('spkTchrList').once('value').then(function(snapshot) {
        appEditor.users.current = snapshot.val() || {};
        firebase.database().ref('newUser/spk').once('value').then(function(snapshot) {
            appEditor.users.pending = snapshot.val() || {};
            buildBossOpts();
        });
    }, function (e) {
        chkPermission(e);
    });
}

function updateUsersDb() {
    var updates = {};
    var currentUids = Object.keys(appEditor.users.current);
    var pendingUids = Object.keys(appEditor.users.pending);
    var absentPendingUids = Object.keys(appEditor.users.absentPending);

    currentUids.forEach( function(uid) {
        updates['spkTchrList/' + uid] = appEditor.users.current[uid];
    });
    pendingUids.forEach( function(uid) {
        updates['newUser/spk/' + uid] = appEditor.users.pending[uid];
    });
    absentPendingUids.forEach( function(uid) {
        updates['newUser/spk/' + uid] = null;
    });

    firebase.database().ref().update(updates, function(e) {
        if (e) {
            chkPermission(e);
            window.mscAlert({
                title: '',
                subtitle: 'Data could not be updated.\n' + e
            });
        } else {
            window.mscAlert({
                title: '',
                subtitle: 'Changes saved!'
            });
            appEditor.users.absentPending = {};
            buildBossOpts();
        }
    });
}

function unrepresentedUsersPending(pendingEls, pendingObj) {
    var currentPendingUids = Object.keys(pendingObj);
    var proposedPending = {};
    var returnObj = {};

    pendingEls.forEach( function (el) {
        proposedPending[el.dataset.uid] = el.dataset.name;
    });
    currentPendingUids.forEach( function (el) {
        if (!proposedPending.hasOwnProperty(el)) {
            returnObj[el] = pendingObj[el];
        }
    });
    return returnObj;
}

function optsUpdateUsers() {
    var pendingObj = JSON.parse(JSON.stringify(appEditor.users.pending));
    var pendingEls = docEl("manageOpts").querySelectorAll(".btn-default");
    var tchrEls = docEl("manageOpts").querySelectorAll(".btn-success");

    appEditor.users.absentPending = unrepresentedUsersPending(pendingEls, pendingObj);
    appEditor.users.removed = {};
    appEditor.users.current = {};
    appEditor.users.pending = {};

    tchrEls.forEach( function (el) {
        appEditor.users.current[el.dataset.uid] = el.dataset.name;
    });
    pendingEls.forEach( function (el) {
        appEditor.users.pending[el.dataset.uid] = el.dataset.name;
    });
    updateUsersDb();
}

function chkForRemovedAccess() {
    var tchrEls = docEl("manageOpts").querySelectorAll(".btn-success");
    var currentUserUids = Object.keys(appEditor.users.current);
    var proposedUsers = {};

    tchrEls.forEach( function (el) {
        proposedUsers[el.dataset.uid] = el.dataset.name;
    });
    currentUserUids.forEach( function (el) { //only checking for removed spkTchrList el.s
        if (!proposedUsers.hasOwnProperty(el)) {
            appEditor.users.removed[el] = appEditor.users.current[el];
        }
    });

    if (!isObjEmpty(appEditor.users.removed)) {
        window.mscConfirm({
            title: 'Warning',
            subtitle: 'This action will remove access for some current users.\nTheir data will also be permanently deleted.\nAre you sure?',
            cancelText: 'Exit',
            onOk: function () {
                removeCurrentUsersData();
            },
            onCancel: function () {
                return;
            }
        });
    } else {
        optsUpdateUsers();
    }
}

function removeCurrentUsersData() { //delete currentUser && data under: 'assessments/' + uid
    var uidArr = Object.keys(appEditor.users.removed);
    var updates = {};

    uidArr.forEach( function (uid) {
        updates['assessments/' + uid] = null;
        updates['spkTchrList/' + uid] = null;
    });

    firebase.database().ref().update(updates, function(e) {
        if (e) {
            chkPermission(e);
            window.mscAlert({
                title: '',
                subtitle: 'User data could not be removed.\n' + e
            });
        } else {
            optsUpdateUsers();
        }
    });
}

function purgePendingFromDb() {
    var updates = {};
    var pendingArr = Object.keys(appEditor.users.pending);

    pendingArr.forEach( function (el) {
        updates['newUser/spk/' + el] = null;
    });
    firebase.database().ref().update(updates, function(e) {
        if (e) {
            chkPermission(e);
            window.mscAlert({
                title: '',
                subtitle: 'Users pending access could not be cleared.\n' + e
            });
        } else {
            window.mscAlert({
                title: '',
                subtitle: 'Changes saved!'
            });
            appEditor.users.pending = {};
            buildBossOpts();
        }
    });
}

function optsDeletePending() {
    window.mscConfirm({
        title: 'Warning',
        subtitle: 'This action will delete all users awaiting access to the app. Proceed?',
        cancelText: 'Exit',
        onOk: function () {
            purgePendingFromDb();
        },
        onCancel: function () {
            return;
        }
    });
}

function optsRevertUsers() {
    chkForOpts();
}

function toggleUserBtnClass(targetEl) {
    if (targetEl.classList.contains("btn-success")) {
        targetEl.className = targetEl.className.replace(/(?:^|\s)btn-success(?!\S)/g, '');
        targetEl.className += " btn-default";
    } else {
        targetEl.className = targetEl.className.replace(/(?:^|\s)btn-default(?!\S)/g, '');
        targetEl.className += " btn-success";
    }
}

function identifyOptsUser(el) {
    if (el.target !== el.currentTarget) {
        if (el.target.nodeName === "DIV") {
            toggleUserBtnClass(el.target);
        }
        el.stopPropagation();
    }
}

function buildBossOpts() {
    var container = docEl("manageOpts"); //main container
    var frag = document.createDocumentFragment();
    var userKeys = Object.keys(appEditor.users.current);
    var pendKeys = Object.keys(appEditor.users.pending);
    var userDiv,
        pendDiv;

    emptyContent(container);

    userKeys.forEach( function(uid) {
        userDiv = document.createElement("div");
        userDiv.className = "btn btn-sm btn-success btn-fixwidth";
        userDiv.dataset.uid = uid;
        userDiv.dataset.name = appEditor.users.current[uid];
        userDiv.textContent = appEditor.users.current[uid] + "\n" + uid;
        frag.appendChild(userDiv);
    });
    pendKeys.forEach( function(uid) {
        pendDiv = document.createElement("div");
        pendDiv.className = "btn btn-sm btn-default btn-fixwidth";
        pendDiv.dataset.uid = uid;
        pendDiv.dataset.name = appEditor.users.pending[uid];
        pendDiv.textContent = appEditor.users.pending[uid] + "\n" + uid;
        frag.appendChild(pendDiv);
    });
    container.appendChild(frag);
    showEl("manageOpts");
    showEl("optActions");
}

//TODO:
//MANAGE SHARED RUBRICS
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

function showEditRubric() {
    if (appEditor.db.rubrics === false) {
        getRubricIndexesFromDb();
    }
    showEl("editRubric");

    if (appEditor.editorIsOpen.rubric === true) {
        showEl("rubricActions");
    }
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
            spreadsheetData[indices[1]][indices[2]] = docEl(item).textContent;
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
    hideEl("sectionInputWrapper");
    hideEl("rubricActions");
    docEl("ac_ru_del").style.display = "none";

    if (appEditor.sharedRubricsIndex.length) { showEl("ruLoadSelected"); }

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
function displayAvailableRubriks(shared) {
    var i;

    emptyContent(docEl("ruLoadChkBoxes"));

    if (shared.length) {
        for (i = 0; i < shared.length; i++) {
            createAvailableRubriksButtons(shared[i]);
        }
    }
    showEl("ruLoadSelected");
}

//TODO
function loadRubriks() { //init
    displayAvailableRubriks(Object.keys(appEditor.sharedRubricsIndex));
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
function getSelectedRubrik(rubricNameKey) { //bool === false: take shared rubrik
    var uid = firebase.auth().currentUser.uid;
    var path = 'sharedRubrics/rubrics/' + rubricNameKey;
    var selectedRubik;

    if (rubricNameKey === "" || rubricNameKey == undefined) {
        displayMsg("f");
        return;
    }
    firebase.database().ref(path).once('value').then(function (snapshot) {
        selectedRubik = snapshot.val();

        if (selectedRubik !== null) {
            appEditor.appEditRecords.loadedRubric = [];
            appEditor.appEditRecords.loadedRubric.push(selectedRubik);
            appEditor.appEditRecords.loadedRubric[0].rubricKey = rubricNameKey;
            appEditor.appEditRecords.loadedRubric[0].isFromShared = true;
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
        i;

    for (i = 0; i < allRubrikBtns.length; i++) {
        if (allRubrikBtns[i].checked) {
            rubricNameKey = allRubrikBtns[i].value;
            break;
        }
    }
    getSelectedRubrik(rubricNameKey);
}

function showLoadedRubrik() {
    var rubrikKeys = [];
    var i;

    showEl("ruNameCurrent");
    docEl("ruNameNewtxt").value = appEditor.appEditRecords.loadedRubric[0].rubricName;
    rubrikKeys = convertFromRubrikObj(); //returns the correct order of sections from appEditor.appEditRecords.loadedRubric...

    for (i = 0; i < rubrikKeys.length; i++) {
        appEditor.table_Id = "" + rubrikKeys[i];
        initNewSectionFromLoad(rubrikKeys[i]);
    }
    appEditor.editorIsOpen.rubric = true;
    hideEl("ruLoadChkBoxes");
    hideEl("ruLoadSelected");
    showEl("sectionInputWrapper");
    showEl("rubricActions");
    docEl("ac_ru_del").style.display = "block";
}

//TODO:
function rubricCommitted(key, idxObj) {
    appEditor.sharedRubricsIndex[key] = idxObj;
    appEditor.appEditRecords.loadedRubric = [];
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
    var chkd = allChksPassForNewRubrik();
    var rubricName = docEl("ruNameNewtxt").value;
    var relevantKey;

    if (chkd !== "true") {
        displayMsg("c", chkd);
        return;
    }
    disableEl("editRubric");

    if (appEditor.appEditRecords.loadedRubric[0] == undefined) { return; }
    //TODO:

    relevantKey = appEditor.appEditRecords.loadedRubric[0].rubricKey;
    window.mscConfirm({
        title: '',
        subtitle: 'Please confirm to update this shared rubric.',
        okText: 'Update',
        cancelText: 'Cancel',
        onOk: function () {
            rubricUpdateExisting(rubricName, relevantKey);
        },
        onCancel: function () {
            return;
        }
    });
}

function rubrikDestroyed(key) {
    appEditor.appEditRecords.loadedRubric = [];
    hideEl("ruLoadSelected");
    exitEditRubrics();
    loadRubriks();
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

function createAvailableRubriksButtons(rubrikNameKey) {
    var container = docEl("ruLoadChkBoxes"); //fieldset
    var frag = document.createDocumentFragment();
    var newInput = document.createElement("input");
    var newLabel = document.createElement("label");

    newInput.id = "ruSelect_" + rubrikNameKey;
    newInput.value = rubrikNameKey;
    newInput.name = "scalor";
    newInput.type = "radio";
    newLabel.htmlFor = "ruSelect_" + rubrikNameKey;
    newInput.dataset.share = true;
    newLabel.className = "shared";
    newLabel.textContent = appEditor.sharedRubricsIndex[rubrikNameKey].rubricName;
    newLabel.style.color = "#337ab7";

    frag.appendChild(newInput);
    frag.appendChild(newLabel);
    container.appendChild(frag);
}

//TODO: paths are for shared rubrics
function rubricUpdateExisting(rubricName, key) { //#1. Rubric exists and needs to be updated
    var postData = convertToRubricObj(rubricName);
    var idxObj = idxObjFromRubricPostData(postData);
    var updates = {};

    updates['sharedRubrics/rubricsIndex/' + key] = idxObj;
    updates['sharedRubrics/rubrics/' + key] = postData;

    firebase.database().ref().update(updates, function(e) {
        if (e) {
            chkPermission(e);
            displayMsg("d", e);
            enableEl("editRubric");
        } else {
            rubricCommitted(key, idxObj);
        }
    });
}

function removeRubrikFromDb(key) {
    var uid = firebase.auth().currentUser.uid;
    var updates = {};

    updates['sharedRubrics/rubricsIndex/' + key] = null;
    updates['sharedRubrics/rubrics/' + key] = null;

    firebase.database().ref().update(updates, function(e) {
        if (e) {
            chkPermission(e);
        } else {
            rubrikDestroyed(key);
        }
    });
}

function getRubricIndexesFromDb() {
    var uid = firebase.auth().currentUser.uid;

    firebase.database().ref('sharedRubrics/rubricsIndex').once('value').then(function(snapshot) {
        appEditor.sharedRubricsIndex = snapshot.val() || {};

        if (!isObjEmpty(appEditor.sharedRubricsIndex)) {
            showEl("ruLoadSelected");
            loadRubriks();
        }
        rubrikHandlersOn();
        appEditor.db.rubrics = true;
    }, function (e) {
        chkPermission(e);
        return;
    });
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

function handlersOn() {
    docEl("manageOpts").addEventListener("click", identifyOptsUser, {capture: false, passive: true}); //toggles: btn-default <-> btn-success
    docEl("updateUsers").addEventListener("click", chkForRemovedAccess, {capture: false, passive: true});
    docEl("deleteUsers").addEventListener("click", optsDeletePending, {capture: false, passive: true});
    docEl("revertUsers").addEventListener("click", optsRevertUsers, {capture: false, passive: true});
    docEl("leEDITOR").addEventListener("click", goToApp, {capture: false, passive: true});
    docEl("leSignout").addEventListener("click", signOutOfApp, {capture: false, passive: true});
}

function rubrikHandlersOn() {
    docEl("newRubrikSectionBtn").addEventListener("click", initNewSectionFromNew, { capture: false, passive: true });
    docEl("editRubric").addEventListener("click", closeDropBtn, { capture: false, passive: true });
    docEl("ac_ru_commit").addEventListener("click", commitRubrik, { capture: false, passive: true });
    docEl("ac_ru_dis").addEventListener("click", discardRubrik, { capture: false, passive: true });
    docEl("ruLoadSelected").addEventListener("click", selectLoadedRubrik, { capture: false, passive: true });
    docEl("ac_ru_del").addEventListener("click", destroyRubrik, { capture: false, passive: true });
    docEl("rubrik").addEventListener("paste", getPaste, false);
}

function goToApp() {
    window.location = "index.html";
}

//window.addEventListener('load', function() {
    firebase.auth().onAuthStateChanged(function(user) {
        if (user) {
            docEl("usrPhoto").src = user.photoURL;
            handlersOn();
            chkForOpts();
            showEditRubric();
        } else {
            // User is signed out...
            window.location = "../index.html";
        }
    });
//});

})();
});