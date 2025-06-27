import requests
import os
import requests
import shutil
import zipfile
import io

def update_addons(version_json_url="https://garcias-garage.de/files-other/nfsh-addons/version.json", addons_root="static/addons"):
    """
    Fetches the version.json, compares versions for each addon,
    downloads and extracts updated ZIPs (preserving folder structure)
    directly into addons_root, and cleans up old data.
    """
    # Ensure the addons root directory exists
    os.makedirs(addons_root, exist_ok=True)

    # Download and parse the JSON manifest
    resp = requests.get(version_json_url, timeout=10)
    resp.raise_for_status()
    manifest = resp.json()

    for name, info in manifest.items():
        latest_version = info["version"]
        zip_url = info["url"]

        version_file = os.path.join(addons_root, f"{name}.version.txt")

        # Read existing version if present
        existing_version = None
        if os.path.isfile(version_file):
            with open(version_file, "r") as vf:
                existing_version = vf.read().strip()

        # Skip if up-to-date
        if existing_version == latest_version:
            print(f"📦 ✅ {name} is already up-to-date (v{latest_version}).")
            continue

        # On version change: clear out any old files for this addon
        # (We assume all extracted files for this addon live in addons_root,
        #  ggf. in einem Subfolder, je nachdem wie die ZIP intern strukturiert ist.)
        # Here we simply delete any leftover folder named after the addon:
        old_folder = os.path.join(addons_root, name)
        if os.path.isdir(old_folder):
            print(f"📦 🚫 Removing old folder {old_folder} (v{existing_version}).")
            shutil.rmtree(old_folder)

        # Download ZIP into memory
        print(f"📦 🌍 Downloading {name} v{latest_version}…")
        zip_resp = requests.get(zip_url, stream=True, timeout=20)
        zip_resp.raise_for_status()
        zip_bytes = io.BytesIO(zip_resp.content)

        # Extract *with* folder structure, directly under addons_root
        print(f"📦 🏋️‍♀️ Extracting {name} into {addons_root}/ …")
        with zipfile.ZipFile(zip_bytes) as zf:
            # This preserves the internal directories of the ZIP
            zf.extractall(addons_root)

        # Write the new version
        with open(version_file, "w") as vf:
            vf.write(str(latest_version))

        print(f"📦 ✅ {name} updated to version {latest_version}.")