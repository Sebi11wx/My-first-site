require('dotenv').config();
const express = require('express');
const { execFile } = require('child_process');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// --- Spotify token ---
async function getSpotifyToken() {
  const creds = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json();
  return data.access_token;
}

// --- Get track info from Spotify ---
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  const match = url.match(/track\/([a-zA-Z0-9]+)/);
  if (!match) return res.status(400).json({ error: 'Invalid Spotify track URL' });

  try {
    const token = await getSpotifyToken();
    const r = await fetch(`https://api.spotify.com/v1/tracks/${match[1]}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const track = await r.json();
    res.json({
      title: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      album: track.album.name
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch track info' });
  }
});

// --- Download ---
app.post('/api/download', async (req, res) => {
  const { url, format } = req.body;
  const match = url.match(/track\/([a-zA-Z0-9]+)/);
  if (!match) return res.status(400).json({ error: 'Invalid URL' });

  // Get track info to build search query
  let query;
  try {
    const token = await getSpotifyToken();
    const r = await fetch(`https://api.spotify.com/v1/tracks/${match[1]}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const track = await r.json();
    query = `${track.artists[0].name} - ${track.name}`;
  } catch (e) {
    return res.status(500).json({ error: 'Spotify lookup failed' });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eat-'));
  const outTemplate = path.join(tmpDir, '%(title)s.%(ext)s');

  // Format flags
  const formatArgs = {
    mp3:  ['-x', '--audio-format', 'mp3',  '--audio-quality', '0'],
    m4a:  ['-x', '--audio-format', 'm4a',  '--audio-quality', '0'],
    ogg:  ['-x', '--audio-format', 'vorbis', '--audio-quality', '0'],
  }[format] || ['-x', '--audio-format', 'mp3'];

  const args = [
    `ytsearch1:${query}`,
    ...formatArgs,
    '--ffmpeg-location', 'ffmpeg',
    '-o', outTemplate,
    '--no-playlist'
  ];

  execFile('yt-dlp', args, (err) => {
    if (err) {
      fs.rmSync(tmpDir, { recursive: true });
      return res.status(500).json({ error: 'Download failed' });
    }

    const files = fs.readdirSync(tmpDir);
    if (!files.length) {
      fs.rmSync(tmpDir, { recursive: true });
      return res.status(500).json({ error: 'No file produced' });
    }

    const filePath = path.join(tmpDir, files[0]);
    res.download(filePath, files[0], () => {
      fs.rmSync(tmpDir, { recursive: true });
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));