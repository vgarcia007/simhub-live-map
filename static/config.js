document.getElementById("save").addEventListener("click", (event) => {

    event.preventDefault();
    conf = getConfig();
    saveConfig(conf);

    // show modal with the id TrackListModal
    //const modalElement = document.getElementById('TrackListModal');
    //const bsModal = new bootstrap.Modal(modalElement, {
    //  backdrop: 'static',
    //  keyboard: true
    //});
    //bsModal.show();

});

function getConfig() {

    const PROXY_TARGET_URL = document.getElementById("PROXY_TARGET_URL").value;
    const mapAPIurl = document.getElementById("mapAPIurl").value;
    const mapboxToken = document.getElementById("mapboxToken").value;
    const mapboxStyle = document.getElementById("mapboxStyle").value;
    const speedZoom = document.getElementById("speedZoom").value;
    const DEBUG = document.getElementById("DEBUG").value;
    const mapInterfaceScale = document.getElementById("mapInterfaceScale").value;

    new_conf = {
        "PROXY_TARGET_URL": PROXY_TARGET_URL,
        "mapAPIurl": mapAPIurl,
        "mapboxToken": mapboxToken,
        "mapboxStyle": mapboxStyle,
        "speedZoom": speedZoom,
        "DEBUG": DEBUG,
        "mapInterfaceScale": mapInterfaceScale
    }
    return new_conf;
}

function saveConfig(conf) {
    console.log("Saving config:", conf);

    fetch('/config-user-update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(conf)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {

                showAlertModal('Success', 'Configuration saved successfully!')
            } else {
                showAlertModal('Error', "Failed to save configuration: " + data.error)
            }
        })
        .catch(error => {
            console.error("Error saving configuration:", error);

            showAlertModal('Error', "An error occurred while saving the configuration.")
        });
}


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