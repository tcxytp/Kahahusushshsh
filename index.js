import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

const PORT = process.env.PORT || 3000;
const SUPER_ADMIN_KEY = process.env.ADMIN_SECRET_KEY || 'Vision@Admin7827#Secure';
const MINI_ADMIN_KEY = process.env.MINI_ADMIN_KEY || 'Vision@MiniAdmin2026#Access';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

function getSupabaseClients() {
  const clients = [];
  const registeredUrls = new Set();

  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    clients.push({
      id: 1,
      name: "Account 1 (Primary)",
      client: createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY),
      bucket: process.env.SUPABASE_BUCKET || 'songs'
    });
    registeredUrls.add(process.env.SUPABASE_URL);
  }

  const envKeys = Object.keys(process.env);
  const detectedIndices = new Set();

  envKeys.forEach(k => {
    const match = k.match(/^SUPABASE_URL_(\d+)$/i);
    if (match) {
      detectedIndices.add(parseInt(match[1], 10));
    }
  });

  const sortedIndices = Array.from(detectedIndices).sort((a, b) => a - b);

  sortedIndices.forEach(idx => {
    const url = process.env[`SUPABASE_URL_${idx}`];
    const key = process.env[`SUPABASE_KEY_${idx}`];
    const bucket = process.env[`SUPABASE_BUCKET_${idx}`] || process.env.SUPABASE_BUCKET || 'songs';

    if (url && key && !registeredUrls.has(url)) {
      clients.push({
        id: idx,
        name: `Account ${idx}`,
        client: createClient(url, key),
        bucket: bucket
      });
      registeredUrls.add(url);
    }
  });

  return clients;
}

function verifyAnyAdmin(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['x-admin-key'];
  const key = authHeader ? authHeader.replace('Bearer ', '').trim() : '';

  if (key === SUPER_ADMIN_KEY) {
    req.adminRole = 'superadmin';
    return next();
  } else if (key === MINI_ADMIN_KEY) {
    req.adminRole = 'miniadmin';
    return next();
  }

  return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Key' });
}

function verifySuperAdminOnly(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['x-admin-key'];
  const key = authHeader ? authHeader.replace('Bearer ', '').trim() : '';

  if (key === SUPER_ADMIN_KEY) {
    req.adminRole = 'superadmin';
    return next();
  }

  return res.status(403).json({ success: false, error: 'Access Denied: Super Admin Only Feature' });
}

app.get('/', (req, res) => {
  res.send('Vision Music Engine Live & Synced.');
});

app.get('/ping', async (req, res) => {
  try {
    const accounts = getSupabaseClients();
    const pingPromises = accounts.map(acc => 
      acc.client.storage.from(acc.bucket).list('', { limit: 1 }).catch(() => null)
    );
    await Promise.all(pingPromises);
    res.status(200).json({ status: 'alive', totalAccountsActive: accounts.length, time: new Date().toISOString() });
  } catch (err) {
    res.status(200).json({ status: 'alive_with_notice', error: err.message });
  }
});

async function scanAccountRealFolders(acc) {
  try {
    const { data: rootItems, error } = await acc.client.storage
      .from(acc.bucket)
      .list('', { limit: 1000 });

    if (error || !rootItems) return [];

    const detectedFolders = new Set();
    rootItems.forEach(item => {
      if (item.name && !item.name.startsWith('.')) {
        if (item.id === null || !item.name.includes('.')) {
          detectedFolders.add(item.name.trim());
        }
      }
    });

    return Array.from(detectedFolders);
  } catch (err) {
    return [];
  }
}

app.get('/playlists', async (req, res) => {
  try {
    const accounts = getSupabaseClients();
    const seenMap = new Map();

    const folderPromises = accounts.map(acc => scanAccountRealFolders(acc));
    const allAccountFolders = await Promise.all(folderPromises);

    allAccountFolders.forEach(folders => {
      folders.forEach(f => {
        if (f && f.trim() !== '') {
          const norm = f.trim().toLowerCase();
          if (!seenMap.has(norm)) {
            seenMap.set(norm, f.trim());
          }
        }
      });
    });

    let list = Array.from(seenMap.values());
    if (list.length === 0) list.push("Hindi Songs");
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch playlists' });
  }
});

app.get('/songs', async (req, res) => {
  try {
    const accounts = getSupabaseClients();
    const songPromises = [];

    for (const acc of accounts) {
      const folders = await scanAccountRealFolders(acc);

      if (folders.length === 0) {
        songPromises.push((async () => {
          try {
            const { data: rootFiles } = await acc.client.storage
              .from(acc.bucket)
              .list('', { limit: 1000, sortBy: { column: 'name', order: 'asc' } });

            if (!rootFiles) return [];

            const audio = rootFiles.filter(f => f.name && f.name.match(/\.(mp3|wav|m4a|aac|ogg|flac)$/i));
            return audio.map((file, idx) => {
              const { data: urlData } = acc.client.storage.from(acc.bucket).getPublicUrl(file.name);
              return {
                id: `root_${acc.id}_${idx + 1}`,
                fileName: file.name,
                title: file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ').trim(),
                url: urlData.publicUrl,
                playlist: "Hindi Songs",
                sizeBytes: file.metadata?.size || 0,
                accountId: acc.id
              };
            });
          } catch (e) {
            return [];
          }
        })());
      } else {
        for (const folder of folders) {
          songPromises.push((async () => {
            try {
              const { data: files } = await acc.client.storage
                .from(acc.bucket)
                .list(folder, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });

              if (!files || files.length === 0) return [];

              const audioFiles = files.filter(f =>
                f.name && !f.name.startsWith('.') &&
                f.name.match(/\.(mp3|wav|m4a|aac|ogg|flac)$/i)
              );

              return audioFiles.map((file, idx) => {
                const filePath = `${folder}/${file.name}`;
                const { data: urlData } = acc.client.storage
                  .from(acc.bucket)
                  .getPublicUrl(filePath);

                const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ').trim();

                return {
                  id: `${folder.toLowerCase().replace(/[^a-z0-9]/g, '')}_${acc.id}_${idx + 1}_${Math.random().toString(36).substring(2, 6)}`,
                  fileName: file.name,
                  title: cleanTitle,
                  url: urlData.publicUrl,
                  playlist: folder,
                  sizeBytes: file.metadata?.size || 0,
                  accountId: acc.id
                };
              });
            } catch (e) {
              return [];
            }
          })());
        }
      }
    }

    const results = await Promise.all(songPromises);
    res.json(results.flat());
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tracks' });
  }
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  const key = (password || '').trim();

  if (key === SUPER_ADMIN_KEY) {
    return res.json({ success: true, role: 'superadmin', message: 'Authenticated as Super Admin' });
  } else if (key === MINI_ADMIN_KEY) {
    return res.json({ success: true, role: 'miniadmin', message: 'Authenticated as Mini Admin' });
  }

  return res.status(401).json({ success: false, error: 'Incorrect Access Key' });
});

app.get('/admin/accounts-overview', verifyAnyAdmin, async (req, res) => {
  try {
    const accounts = getSupabaseClients();
    
    const overviewPromises = accounts.map(async (acc) => {
      const realFolders = await scanAccountRealFolders(acc);
      let totalSizeBytes = 0;
      let totalSongsCount = 0;
      const folderBreakdown = {};

      const folderPromises = realFolders.map(async (folder) => {
        try {
          const { data: files } = await acc.client.storage.from(acc.bucket).list(folder, { limit: 1000 });
          const audioFiles = (files || []).filter(f =>
            f.name && !f.name.startsWith('.') && f.name.match(/\.(mp3|wav|m4a|aac|ogg|flac)$/i)
          );

          let folderBytes = 0;
          audioFiles.forEach(f => { folderBytes += f.metadata?.size || 0; });

          return { bytes: folderBytes, count: audioFiles.length, folder };
        } catch (e) {
          return { bytes: 0, count: 0, folder };
        }
      });

      const folderResults = await Promise.all(folderPromises);
      folderResults.forEach(resItem => {
        totalSizeBytes += resItem.bytes;
        totalSongsCount += resItem.count;
        folderBreakdown[resItem.folder] = resItem.count;
      });

      const ONE_GB_BYTES = 1024 * 1024 * 1024;
      const isFull = totalSizeBytes >= ONE_GB_BYTES;
      const usedMB = (totalSizeBytes / (1024 * 1024)).toFixed(2);
      const usedGB = (totalSizeBytes / (1024 * 1024 * 1024)).toFixed(3);
      const percentUsed = Math.min(100, ((totalSizeBytes / ONE_GB_BYTES) * 100)).toFixed(1);

      return {
        id: acc.id,
        name: acc.name,
        bucket: acc.bucket,
        totalSongs: totalSongsCount,
        usedBytes: totalSizeBytes,
        usedMB: usedMB,
        usedGB: usedGB,
        percentUsed: percentUsed,
        isFull: isFull,
        folders: realFolders,
        folderBreakdown: folderBreakdown
      };
    });

    const overview = await Promise.all(overviewPromises);
    res.json({ success: true, role: req.adminRole, accounts: overview });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/admin/create-playlist', verifySuperAdminOnly, async (req, res) => {
  try {
    const { accountId, playlistName } = req.body;
    if (!playlistName || !playlistName.trim()) {
      return res.status(400).json({ success: false, error: 'Playlist name required' });
    }

    const cleanFolder = playlistName.trim().replace(/[/\\?%*:|"<>]/g, '');
    const accounts = getSupabaseClients();
    const acc = accounts.find(a => a.id === parseInt(accountId, 10)) || accounts[0];

    const placeholderPath = `${cleanFolder}/.init`;
    const emptyBuf = Buffer.from('vision-folder-manifest');

    const { error } = await acc.client.storage
      .from(acc.bucket)
      .upload(placeholderPath, emptyBuf, { upsert: true });

    if (!error) {
      res.json({ success: true, message: `Playlist "${cleanFolder}" created successfully!` });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/admin/upload', verifyAnyAdmin, upload.array('songFiles', 50), async (req, res) => {
  try {
    const { accountId, playlist } = req.body;
    const files = req.files;

    if (!files || files.length === 0 || !playlist) {
      return res.status(400).json({ success: false, error: 'Files and Playlist are required' });
    }

    const accounts = getSupabaseClients();
    let targetAcc = null;

    if (accountId) {
      targetAcc = accounts.find(a => a.id === parseInt(accountId, 10));
    }

    if (!targetAcc) targetAcc = accounts[0];

    let uploadedCount = 0;
    for (const file of files) {
      const cleanBaseName = file.originalname.replace(/\.[^/.]+$/, '').trim().replace(/[/\\?%*:|"<>]/g, '');
      const cleanFileName = `${cleanBaseName}.mp3`;
      const targetFilePath = `${playlist}/${cleanFileName}`;

      const { error } = await targetAcc.client.storage
        .from(targetAcc.bucket)
        .upload(targetFilePath, file.buffer, { contentType: file.mimetype || 'audio/mpeg', upsert: true });

      if (!error) uploadedCount++;
    }

    res.json({
      success: true,
      message: `Uploaded ${uploadedCount} songs to [${playlist}] successfully!`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/admin/delete', verifyAnyAdmin, async (req, res) => {
  try {
    const { accountId, playlist, fileName } = req.body;
    if (!playlist || !fileName) {
      return res.status(400).json({ success: false, error: 'Playlist & fileName required' });
    }

    const targetFilePath = `${playlist}/${fileName}`;
    const accounts = getSupabaseClients();
    let targetAcc = accountId ? accounts.find(a => a.id === parseInt(accountId, 10)) : null;

    if (targetAcc) {
      const { data, error } = await targetAcc.client.storage.from(targetAcc.bucket).remove([targetFilePath]);
      if (!error) {
        return res.json({ success: true, message: `"${fileName}" deleted successfully.` });
      }
    }

    for (const a of accounts) {
      const { data, error } = await a.client.storage.from(a.bucket).remove([targetFilePath]);
      if (!error) {
        return res.json({ success: true, message: `"${fileName}" deleted successfully.` });
      }
    }

    res.status(500).json({ success: false, error: 'Could not remove file' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
