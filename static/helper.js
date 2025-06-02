fetch('/config')
    .then(response => response.json())
    .then(config => {
    var CONFIG = config;
    runHelper(CONFIG);
    
    })
    .catch(err => console.error("Error loading config:", err));

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
        const speed = data.NewData.FilteredSpeedKmh

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

        //document.getElementById("json").textContent = JSON.stringify(jsonOut, null, 2);
    } catch (err) {
        console.error("API-Error:", err);
    } finally {
        runHelper.fetchInProgress = false;
        setTimeout(() => runHelper(config), config.fetchIntervalMs);
        
    }
}

document.getElementById("bing").addEventListener("click", () => {
        const trackCode = document.getElementById("TrackCode").value;
        searchMap("bing", trackCode);
    });
document.getElementById("google").addEventListener("click", () => {
        const trackCode = document.getElementById("TrackCode").value;
        searchMap("google", trackCode);
    });

document.getElementById("gpsPaste").addEventListener("click", () => {
        // get clipboard content
        navigator.clipboard.readText()
            .then(text => {
                // set the value of the input field
                document.getElementById("gps").value = text;
            })
            .catch(err => console.error('Failed to read clipboard contents: ', err));
    });

    

document.getElementById("generate").addEventListener("click", () => {
    //get values of all inputs
    const gameName = document.getElementById("GameName").value;
    const trackCode = document.getElementById("TrackCode").value;
    const yaw = document.getElementById("yaw").value;
    const coordinatesX = document.getElementById("CoordinatesX").value;
    const coordinatesY = document.getElementById("CoordinatesY").value;
    const notes = document.getElementById("notes").value;
    const gps = document.getElementById("gps").value;
    const gps_new = gps.replace(", ", "#");
    const gpsParts = gps_new.split("#").map(part => part.trim());
    const lat = gpsParts[0].replace(",", ".");
    const lng = gpsParts[1].replace(",", ".");
  
    console.log("GPS Coordinates:", lat, lng);

    const result_json ={ 
          "notes": notes,
          "CoordinatesX": parseFloat(coordinatesX),
          "CoordinatesY": parseFloat(coordinatesY),
          "lat": parseFloat(lat),
          "lng": parseFloat(lng)
        }
    ref_points.push(result_json);

    const full_json = {
        [trackCode]: {
        "yaw": parseFloat(yaw),
        "ref_points": ref_points
        }
    }
    // Als JSON-String
        const asString = JSON.stringify(full_json, null, 2);

        // Jetzt entfernen wir die äußeren { } mit einem kleinen Trick
        const stripped = asString.slice(1, -1).trim(); // schneidet erstes und letztes Zeichen ab
    document.getElementById("result").textContent = stripped;
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