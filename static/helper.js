fetch('/config')
    .then(response => response.json())
    .then(config => {
        var CONFIG = config;
        runHelper(CONFIG);

    })
    .catch(err => console.error("Error loading config:", err));

let first_load = true;

const ref_points = []

/**
 * Asynchronously fetches data from a specified API and processes it to update the UI and internal state.
 * Ensures that only one fetch operation is in progress at a time.
 *
 * @async
 * @function runHelper
 * @param {Object} config - Configuration object for the helper function.
 * @param {string} config.mapAPIurl - The URL of the API to fetch data from.
 * @param {number} config.fetchIntervalMs - The interval in milliseconds to wait before the next fetch.
 * @throws {Error} Throws an error if the API response format is invalid.
 */
async function runHelper(config) {
    if (runHelper.fetchInProgress) return;
    runHelper.fetchInProgress = true;

    try {
        const res = await fetch(config.mapAPIurl);
        const data = await res.json();

        if (!data?.NewData?.FeedbackData) throw new Error("Invalid API format");

        const d = data.NewData.FeedbackData;
        const gameName = data.GameName;
        const trackCode = data.NewData.TrackCode;
        const yaw = d.OrientationYaw;
        const speed = data.NewData.FilteredSpeedKmh;

        jsonOut = {
            "IsGameInRace": data.IsGameInRace,
            "GameName": gameName,
            "TrackCode": trackCode,
            "CoordinatesX": d.CoordinatesX,
            "CoordinatesY": d.CoordinatesY,
            "OrientationYaw": yaw,
            "FilteredSpeedKmh": speed
        };

        document.getElementById("GameName").value = gameName;
        document.getElementById("TrackCode").value = trackCode;
        document.getElementById("CoordinatesX").value = d.CoordinatesX;
        document.getElementById("CoordinatesY").value = d.CoordinatesY;

        if (first_load) {
            loadRefPoints();
            first_load = false;
        }
    } catch (err) {
        console.error("API-Error:", err);
    } finally {
        runHelper.fetchInProgress = false;
        setTimeout(() => runHelper(config), config.fetchIntervalMs);

    }
}


/**
 * Loads reference points for a specific game and track from a server endpoint,
 * updates the global `ref_points` array, and populates the UI with the loaded data.
 *
 * The function retrieves the game name and track code from the DOM elements
 * with IDs "GameName" and "TrackCode", respectively. It then constructs a URL
 * to fetch the reference points in JSON format. Once the data is fetched, it
 * clears the `ref_points` array, populates it with the fetched data, updates
 * the yaw value in the UI, and calls helper functions to build the JSON and
 * list representations of the reference points.
 *
 * @function loadRefPoints
 * @returns {void}
 * @throws {Error} Logs an error message to the console if the fetch request fails.
 */
function loadRefPoints() {
    url = "/refpoints/<game>/<track>";
    const gameName = document.getElementById("GameName").value;
    const trackCode = document.getElementById("TrackCode").value;
    url = url.replace("<game>", gameName).replace("<track>", trackCode);
    fetch(url)
        .then(response => response.json())
        .then(data => {
            // Clear the ref_points array
            console.log("Loaded reference points:", data);
            ref_points.length = 0;

            // Populate the ref_points array with data from the JSON file
            data.ref_points.forEach(point => {
                ref_points.push({
                    notes: point.notes,
                    CoordinatesX: point.CoordinatesX,
                    CoordinatesY: point.CoordinatesY,
                    lat: point.lat,
                    lng: point.lng
                });
            });
            document.getElementById("yaw").value = data.yaw || 0;
            buildJSON(ref_points);
            buildList(ref_points);
        })
        .catch(err => console.error("Error loading reference points:", err));
}


document.getElementById("yaw").addEventListener("keyup", () => {
    event.preventDefault();
    const yaw = document.getElementById("yaw").value;
    const trackCode = document.getElementById("TrackCode").value;
    buildJSON(ref_points);
});

document.getElementById("bing").addEventListener("click", () => {

    event.preventDefault();
    const trackCode = document.getElementById("TrackCode").value;
    searchMap("bing", trackCode);
});

document.getElementById("google").addEventListener("click", () => {
    event.preventDefault();
    const trackCode = document.getElementById("TrackCode").value;
    searchMap("google", trackCode);
});

document.getElementById("gpsPaste").addEventListener("click", () => {
    event.preventDefault();
    navigator.clipboard.readText()
        .then(text => {
            // set the value of the input field
            document.getElementById("gps").value = text;
        })
        .catch(err => console.error('Failed to read clipboard contents: ', err));
});

document.getElementById("load").addEventListener("click", () => {
    loadRefPoints();
});

document.getElementById("save").addEventListener("click", () => {
    event.preventDefault();
    //get json from the result div and post it to /save-refpoints/<game>
    const result = document.getElementById("result").textContent;
    const gameName = document.getElementById("GameName").value;
    const trackCode = document.getElementById("TrackCode").value;
    const url = `/save-refpoints/${gameName}`;
    fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: result
        })
        .then(response => {
            if (response.ok) {
                showAlertModal("Success", "Reference points saved successfully!");
            } else {
                //the returning json contains the key error we need to display it
                return response.json().then(data => {
                    showAlertModal("Error", data.error);
                });

            }
        })

});



document.getElementById("generate").addEventListener("click", () => {
    event.preventDefault();
    const coordinatesX = document.getElementById("CoordinatesX").value;
    const coordinatesY = document.getElementById("CoordinatesY").value;
    const notes = document.getElementById("notes").value;
    let lat, lng; // <-- hier außerhalb deklarieren
    try {
        const gps = document.getElementById("gps").value;
        const gps_new = gps.replace(", ", "#");
        const gpsParts = gps_new.split("#").map(part => part.trim());
        lat = gpsParts[0].replace(",", ".");
        lng = gpsParts[1].replace(",", ".");
    } catch (error) {
        showAlertModal("Error", "Invalid GPS format. Please use strings like '50.341456263483394, 6.954064802665204' or '50,335810, 6,945043'.");
        return;
    }

    console.log("GPS Coordinates:", lat, lng);

    const result_json = {
        "notes": notes,
        "CoordinatesX": parseFloat(coordinatesX),
        "CoordinatesY": parseFloat(coordinatesY),
        "lat": parseFloat(lat),
        "lng": parseFloat(lng)
    }
    ref_points.push(result_json);

    buildJSON(ref_points);
    buildList(ref_points);
    document.getElementById("gps").value = ""; // Clear the GPS input field
    document.getElementById("notes").value = ""; // Clear the notes input field
});

/**
 * Builds a JSON object based on the provided reference points and user input from the DOM,
 * and displays the resulting JSON string in the element with ID "result".
 *
 * @param {Array} ref_points - An array of reference points to include in the JSON object.
 * @returns {void} This function does not return a value.
 */
function buildJSON(ref_points) {
    const trackCode = document.getElementById("TrackCode").value;
    const yaw = document.getElementById("yaw").value;
    const full_json = {
        [trackCode]: {
            "yaw": parseFloat(yaw),
            "ref_points": ref_points
        }
    }
    const asString = JSON.stringify(full_json, null, 2);
    //const stripped = asString.slice(1, -1).trim();
    document.getElementById("result").textContent = asString;
}

/**
 * Builds and updates a list of reference points in the DOM.
 * 
 * This function dynamically creates and populates a list element with the provided
 * reference points. Each list item includes a JSON representation of the point and
 * a delete button. Clicking the delete button removes the corresponding point from
 * the list and updates the DOM accordingly.
 * 
 * @param {Array<Object>} ref_points - An array of reference point objects to be displayed in the list.
 * Each object is expected to be serializable to JSON.
 */
function buildList(ref_points) {
    console.log("Building list with reference points:", ref_points);
    const list = document.getElementById("ref_points_list");
    list.innerHTML = ""; // Clear existing list items

    ref_points.forEach((point, index) => {
        console.log("Adding point to list:", point);

        const item = document.createElement("li");
        item.className = "list-group-item d-flex justify-content-between align-items-start";
        const div = document.createElement("div");
        div.className = "ms-2 me-auto";
        const pre = document.createElement("pre");
        pre.textContent = JSON.stringify(point, null, 2);
        div.appendChild(pre);
        item.appendChild(div);
        const button = document.createElement("button");
        button.className = "btn btn-sm btn-danger list-del-item";
        button.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
        button.addEventListener("click", () => {
            ref_points.splice(index, 1);
            buildList(ref_points);
        });
        item.appendChild(button);
        list.appendChild(item);
        buildJSON(ref_points);

    });
}


/**
 * Opens a new browser tab to search for a location on the specified map provider.
 *
 * @param {string} provider - The map provider to use for the search. Supported values are "google" and "bing".
 * @param {string} term - The search term or location to look for on the map.
 *
 * @throws Will display an alert if the provider is unsupported or if the search term is empty.
 */
function searchMap(provider, term) {
    const encoded = encodeURIComponent(term);

    let url = "";

    switch (provider) {
        case "google":
            url = `https://www.google.com/maps/search/?api=1&query=${encoded}`;
            break;
        case "bing":
            url = `https://www.bing.com/maps?q=${encoded}`;
            break;
        default:
            alert("Unsupported provider");
            return;
    }

    if (term) {
        window.open(url, "_blank");
    } else {
        alert("Please enter a location.");
    }
}

/**
 * Displays a Bootstrap modal with a customizable title and message.
 * The modal is styled based on the title, showing an error or success icon if applicable.
 *
 * @param {string} title - The title of the modal. If "Error", an error icon is displayed. If "Success", a success icon is displayed.
 * @param {string} message - The message to display in the modal body.
 */
function showAlertModal(title, message) {
    const ModalLabel = document.getElementById('alertModalLabel');
    if (title == "Error") {
        title = '<i class="fa-solid fa-triangle-exclamation fa-2x text-danger"></i>';
    }
    if (title == "Success") {
        title = '<i class="fa-solid fa-circle-check fa-2x text-success"></i>';
    }
    ModalLabel.innerHTML = title;
    const ModalBody = document.getElementById('alertModalBody');
    ModalBody.innerHTML = message;

    const modalElement = document.getElementById('alertModal');
    const bsModal = new bootstrap.Modal(modalElement, {
        backdrop: 'static',
        keyboard: true
    });

    bsModal.show();
}