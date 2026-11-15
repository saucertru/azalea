<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Scramjet Proxy</title>
  <script src="/baremux/index.js"></script>
  <script src="/scramjet/scramjet.all.js"></script>
</head>
<body style="font-family: sans-serif; text-align: center; margin-top: 100px;">
  <h1>Web Proxy</h1>
  <form id="proxy-form">
    <input type="text" id="url-input" placeholder="Enter URL or search..." style="width: 320px; padding: 10px;" required />
    <button type="submit" style="padding: 10px 20px;">Go</button>
  </form>

  <script>
    const { ScramjetController } = $scramjetLoadController();
    const scramjet = new ScramjetController({
      files: {
        wasm: '/scramjet/scramjet.wasm.wasm',
        all: '/scramjet/scramjet.all.js',
        sync: '/scramjet/scramjet.sync.js',
      },
    });

    scramjet.init();

    const connection = new BareMux.BareMuxConnection('/baremux/worker.js');

    async function setupProxy() {
      await navigator.serviceWorker.register('/sw.js');
      const wispUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/wisp/';
      await connection.setTransport('/epoxy/index.mjs', [{ wisp: wispUrl }]);
    }

    setupProxy();

    document.getElementById('proxy-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      let input = document.getElementById('url-input').value.trim();
      if (!input.startsWith('http://') && !input.startsWith('https://')) {
        input = 'https://' + input;
      }
      window.location.href = scramjet.encodeUrl(input);
    });
  </script>
</body>
</html>