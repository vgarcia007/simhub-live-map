fetch('/config')
    .then(response => response.json())
    .then(config => {
    var CONFIG = config;
    runHelper(CONFIG);
    
    })
    .catch(err => console.error("Error loading config:", err));

let first_load = true;

const ref_points=[]

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

        jsonOut ={
            "IsGameInRace": data.IsGameInRace,
            "GameName": gameName,
            "TrackCode": trackCode,
            "CoordinatesX": d.CoordinatesX,
            "CoordinatesY": d.CoordinatesY,
            "OrientationYaw": yaw,
            "FilteredSpeedKmh": speed
        };

        document.getElementById("GameName").value= gameName;
        document.getElementById("TrackCode").value= trackCode;
        document.getElementById("CoordinatesX").value= d.CoordinatesX;
        document.getElementById("CoordinatesY").value= d.CoordinatesY;

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


function loadRefPoints(){
        url  ="/refpoints/<game>/<track>";
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


document.getElementById("yaw").addEventListener("keyup" , () => {
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
    let lat, lng;  // <-- hier außerhalb deklarieren
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

    const result_json ={ 
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

function listTracks() {
    // fetch track reference points JSON
    fetch('/static/track_reference_points.json')
        .then(response => response.json())
        .then(data => {
            const trackList = document.getElementById("trackList");
            trackList.innerHTML = ""; // Clear existing options

            Object.keys(data).forEach(game => {
                const gameOption = document.createElement("optgroup");
                gameOption.label = game;

                Object.keys(data[game]).forEach(track => {

                    const option = document.createElement("option");
                    option.value = `${game}/${track}`;
                    // Add a delete button to each option (if needed)

                    option.className = "track-option";
                    option.textContent = `${game} - ${track}`;
                    option.addEventListener("click", (event) => {
                        event.preventDefault();
                        const trackCode = `${game}/${track}`;
                        const url = `/delete-track/${trackCode}`;
                        fetch(url)
                            .then(response => response.json())
                            .then(() => {

                                const modalElement = document.getElementById('TrackListModal');
                                const bsModal = bootstrap.Modal.getInstance(modalElement);
                                if (bsModal) {
                                    bsModal.hide();
                                }
                                //reload the window
                                window.location.href = "/helper";

                            })
                            .catch(err => console.error("Error loading track data:", err));
                    });
                    gameOption.appendChild(option);
                });

                trackList.appendChild(gameOption);
            });
        })
        .catch(err => console.error("Error loading track list:", err));
    }

// eventlistener for tracks click
document.getElementById("tracks").addEventListener("click", (event) => {
    
    event.preventDefault();
    listTracks();
    // show modal with the id TrackListModal
    const modalElement = document.getElementById('TrackListModal');
    const bsModal = new bootstrap.Modal(modalElement, {
      backdrop: 'static',
      keyboard: true
    });
    bsModal.show();
    
});


function searchMap(provider,term) {
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

function showAlertModal(title,message) {
    const ModalLabel = document.getElementById('alertModalLabel');
    if (title =="Error") {
        title='<i class="fa-solid fa-triangle-exclamation fa-2x text-danger"></i>';
    }
    if (title =="Success") {
        title='<i class="fa-solid fa-circle-check fa-2x text-success"></i>';
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