fetch('/config')
    .then(response => response.json())
    .then(config => {
    var CONFIG = config;
    runHelper(CONFIG);
    
    })
    .catch(err => console.error("Error loading config:", err));

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

        document.getElementById("json").textContent = JSON.stringify(jsonOut, null, 2);
    } catch (err) {
        console.error("API-Error:", err);
    } finally {
        runHelper.fetchInProgress = false;
        
    }
}