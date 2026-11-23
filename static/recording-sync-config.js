'use strict';

(() => {
    const form = document.getElementById('recording-sync');
    const fields = document.getElementById('recording-sync-fields');
    const input = form.elements;
    const results = document.getElementById('recording-sync-results');
    const feedback = document.getElementById('recording-sync-result');
    const status = document.getElementById('recording-sync-status');
    const passwordNote = document.getElementById('recording-sync-password-note');
    const simHubHost = document.getElementById(form.dataset.simhubHostInput);
    const discover = document.getElementById('recording-sync-discover');
    const test = document.getElementById('recording-sync-test');

    async function request(operation, settings) {
        const options = { cache: 'no-store' };
        if (settings) {
            options.method = 'POST';
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify(settings);
        }
        const response = await fetch(form.dataset.url + operation, options);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'The sync settings are unavailable.');
        return result;
    }

    function showFeedback(message = '', error = false) {
        feedback.textContent = message;
        feedback.classList.toggle('text-danger', error);
    }

    function showStatus(settings) {
        const descriptions = {
            disabled: 'Automatic sync is off.',
            waiting: 'Waiting for the next sync.',
            syncing: 'Checking for new or changed recordings…',
            ready: 'Recording library is up to date.',
            error: settings.issue || 'The sync could not finish.',
        };
        const last = settings.last_success && new Date(settings.last_success).toLocaleString();
        status.textContent = descriptions[settings.status] + (last ? ' Last successful sync: ' + last : '');
    }

    function showSource() {
        const direct = input.source.value === 'smb';
        document.getElementById('recording-sync-smb').hidden = !direct;
        test.hidden = !direct;
        results.hidden = true;
    }

    function setSettings(settings) {
        input.enabled.checked = settings.enabled;
        input.source.value = settings.source;
        document.getElementById('recording-sync-source-row').hidden = !settings.mount_available;
        for (const field of ['host', 'share', 'folder', 'username']) input[field].value = settings[field];
        input.host.placeholder = simHubHost.value;
        input.password.value = '';
        passwordNote.textContent = settings.has_password ? 'A password is stored for this server and account.' : '';
        showSource();
        showStatus(settings);
    }

    function readSettings() {
        return {
            enabled: input.enabled.checked,
            source: input.source.value,
            host: input.host.value || simHubHost.value,
            share: input.share.value,
            folder: input.folder.value,
            username: input.username.value,
            password: input.password.value,
        };
    }

    async function run(operation, waiting, onSuccess) {
        const settings = readSettings();
        fields.disabled = true;
        showFeedback(waiting);
        try {
            onSuccess(await request(operation, settings));
        } catch (error) {
            showFeedback(error.message, true);
        } finally {
            fields.disabled = false;
        }
    }

    input.source.addEventListener('change', showSource);
    input.host.addEventListener('input', () => { results.hidden = true; });
    simHubHost.addEventListener('input', () => { input.host.placeholder = simHubHost.value; });
    results.addEventListener('change', () => {
        if (results.value) input.share.value = results.value;
    });
    discover.addEventListener('click', () => {
        results.hidden = true;
        run('/discover', 'Looking for file shares…', data => {
            if (!data.shares.length) {
                showFeedback('No file shares were listed. You can enter a share name or UNC path directly.');
                return;
            }
            results.replaceChildren(new Option('Select a share', ''));
            for (const share of data.shares) results.add(new Option(share, share));
            results.hidden = false;
            results.focus();
            showFeedback('');
        });
    });
    test.addEventListener('click', () => run('/test', 'Testing read access…', data => {
        showFeedback(data.has_recordings
            ? 'Connection successful. SimHub recording folders found.'
            : 'Connection successful. No SimHub recording folders were found at this path.');
    }));
    form.addEventListener('submit', event => {
        event.preventDefault();
        run('', 'Saving recording sync…', settings => {
            setSettings(settings);
            showFeedback('Recording sync settings saved.');
        });
    });

    request('').then(settings => {
        setSettings(settings);
        fields.disabled = false;
        window.setInterval(() => {
            if (!fields.disabled) request('').then(showStatus).catch(() => {});
        }, 5000);
    }).catch(error => showFeedback(error.message, true));
})();
