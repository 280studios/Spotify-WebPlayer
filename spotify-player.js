// spotify-player.js
const controllerAbort = new AbortController();
const signalAbort = controllerAbort.signal;
const defaultAlbumCover = 'where.webp'; // Placeholder image
let skipSongTimer = null;
let backGradientScale = 0.2; // Initial scale for the background image

// FIX - Ignore the calls to Analytics end points.
const originalFetch = window.fetch;
window.fetch = async function(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  
  // If this is a request to Spotify's analytics endpoint, handle specially
  if (url.includes('cpapi.spotify.com') || url.includes('event/item_before_load')) {
    try {
      const response = await originalFetch(input, init);
      
      // If we get a 404 or 400, return a fake successful response
      if (response.status === 404 || response.status === 400) {
        console.log(`Intercepted ${response.status} response for ${url.split('?')[0]}`);
        return new Response(JSON.stringify({success: true}), {
          status: 200,
          headers: {'Content-Type': 'application/json'}
        });
      }
      return response;
    } catch (error) {
      console.log(`Intercepted fetch error for ${url.split('?')[0]}`);
      // Return a fake successful response instead of throwing
      return new Response(JSON.stringify({success: true}), {
        status: 200,
        headers: {'Content-Type': 'application/json'}
      });
    }
  }

  // Pass through normal requests
  return originalFetch(input, init);
  // Credit: https://github.com/NeilARaman/spotify-vinyl-project/blob/bd5a035fbde642e76414e2bbee67e6c29061af38/src/components/SpotifyPlayer.tsx#L112
};

// Start fetching token when the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  fetchAccessToken();

  if (!isOnline()) {
    displayStatusText('You are offline. Please check your internet connection.');
  }

  if (!isSSL()) {
    displayStatusText('This site is not using a secure connection (SSL). Please use HTTPS.');
  }
});

// Function to check if the user is online
function isOnline() {
  return navigator.onLine;
}

// Function to check if the site is using SSL
function isSSL() {
  return location.protocol === 'https:';
}

// Function to initialize the Spotify SDK
window.onSpotifyWebPlaybackSDKReady = () => {
  try {
    const playPauseBtn = document.getElementById('play-pause-btn');
    const nextBtn = document.getElementById('next-btn');
    const prevBtn = document.getElementById('prev-btn');
    const connectBtn = document.getElementById('connect-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');
    const trackSeek = document.getElementById('seek-range');
    const volumeBar = document.getElementById('volume-bar');
    const songCurrentTime = document.getElementById('song-current-time');
    const songTimeMax = document.getElementById('song-end-time');
    const backGradientImg = document.getElementById('albumCoverbackground');
    //const trackImg = document.getElementById('track-cover');
  
    const token = fetchAccessToken();
    const localSpotifyPlayerName = "WebPlayerV1.0"; // Name of the local player
  
    let isPlayerReady = false;
    let isPlayerConnected = false;
    let updateTimer = 12; // Default update timer for player updates in seconds

    displayStatusText('Loading...');
  
    if (!token) {
      console.error('No access token found');
      return;
    }
  
    const player = new Spotify.Player({
      name: localSpotifyPlayerName,
      getOAuthToken: callback => {
        callback(token);
      },
      volume: 0.3, // Default volume
      enableMediaSession: true
    });
  
    // Ready or Not
    player.addListener('ready', ({ device_id }) => {
      sessionStorage.setItem('localDeviceId', device_id);
      isPlayerReady = true;
      console.log('Ready with Device ID: ', device_id);

      getAndShowDevices(device_id);
      getAndDisplayTrackInfo();
      
      if (backGradientImg) {
        backGradientImg.transition = 'scale 0.4s ease-in-out';
        backGradientScale = 0.2;
        backGradientImg.style.scale = backGradientScale;
      }
    });  
  
    player.addListener('not_ready', ({ device_id }) => {
      isPlayerReady = false;
      console.log('Device ID has gone offline', device_id);
    });
  
    // Connect to the player
    player.connect().then(success => {
      if (success) {
        isPlayerConnected = true;
        console.log('%cThe Player: ' + localSpotifyPlayerName + ' has connected to Spotify!', 'color: green');
      } else {
        isPlayerConnected = false;
        handlePlayerError('connect_error', success);
      }
    });
  
    // Error handling
    player.addListener('initialization_error', ({ message }) => {
      handlePlayerError('initialization_error', message);
    });
    player.addListener('authentication_error', ({ message }) => {
      handlePlayerError('authentication_error', message);
    });
    player.addListener('account_error', ({ message }) => {
      handlePlayerError('account_error', message);
    });
    player.addListener('playback_error', ({ message }) => {
      handlePlayerError('playback_error', message);
    });
    player.addListener('autoplay_failed', ({ message }) => {
      handlePlayerError('autoplay_failed', message);
    });
  
    const trackName = document.getElementById('track-name');
    let trackText = trackName && trackName !== 'Not connected' ? true : false;
  
    // Periodically fetch the current track information
    const updateTimerX = Math.max(0, Math.round(updateTimer)) * 1000;
    const updateLoop = async () => {
      if (isPlayerReady && isPlayerConnected && trackText) {
        const success = await getAndDisplayTrackInfo();
        if (!success) {
          clearTimeout(updateLoop);
          return;
        }
      }
      setTimeout(updateLoop, updateTimerX);  // 12s
    };
    updateLoop();

    // Playback status updates
    player.addListener('player_state_changed', state => {
      if (!state) {
        return;
      }
  
      if (state.paused) {
        // Play
        playPauseBtn.textContent = '\u25BA';
      } else {
        playPauseBtn.textContent = '\u23F8';
      }
  
      // Update player UI
      getAndDisplayTrackInfo();
      getAndShowDevices(state.device_id);
  
      // Volume & seek updates
      let maxMinutes = Math.floor(state.duration / 60000);
      let maxSeconds = Math.floor((state.duration % 60000) / 1000);
      songTimeMax.textContent = maxMinutes + ":" + (maxSeconds < 10 ? '0' : '') + maxSeconds;
      trackSeek.max = parseInt(state.duration / 1000);
  
      player.getCurrentState().then(state => {
        if (!state) return;
  
        // Update player UI
        playerUpdateUi('visible');
  
        // Update the seek & volume range continuously
        if (!state.paused) {
          setInterval(() => {
            player.getCurrentState().then(state => {
              if (!state) return;
              // Seekbar
              let currentMinutes = Math.floor(state.position / 60000);
              let currentSeconds = Math.floor((state.position % 60000) / 1000);
              trackSeek.value = Math.floor(state.position / 1000);
              songCurrentTime.textContent = currentMinutes + ":" + (currentSeconds < 10 ? '0' : '') + currentSeconds;
  
              // Volumebar
              player.getVolume().then(volume => {
                let volume_percentage = volume * 100;
                if(volume_percentage <= 100 && volume_percentage >= 0) {
                  volumeBar.value = volume_percentage;
                }
              })
            });
          }, 900);
        }
      });
  
    });
    
    /* Debugging player state changes
    player.addListener('player_state_changed', ({
      position,
      duration,
      track_window: { current_track }
    }) => {
      console.log('Currently Playing', current_track);
      console.log('Position in Song', position);
      console.log('Duration of Song', duration);
    });
    */  
  
    // Button Event listeners
    playPauseBtn.addEventListener('click', () => {
      player.togglePlay();
    });
    nextBtn.addEventListener('click', () => {
      player.nextTrack();
      skipSongUpdateUi();
    });
    prevBtn.addEventListener('click', () => {
      player.previousTrack();
      skipSongUpdateUi();
    });
    volumeBar.addEventListener('input', () => {
      let volume_percentage = parseInt(volumeBar.value) / 100;
      player.setVolume(volume_percentage);
    });
    trackSeek.addEventListener('change', () => {
      let seekInputVal = parseInt(trackSeek.value * 1000);
      player.seek(seekInputVal);
    });
    connectBtn.addEventListener('click', () => {
      // Connect to the player button
      getAndDisplayTrackInfo();
      getAndShowDevices();
      reloadToken();
      sessionStorage.removeItem('localDeviceId');
  
      if (!isPlayerReady) {
        player.connect();
      }
    });
    disconnectBtn.addEventListener('click', async () => {
      if (isPlayerReady && isPlayerConnected) {
        try {
          const state = await player.getCurrentState();
          if (state && state.track_window && state.track_window.current_track) {
            await transferPlaybackToAnotherDevice();
          }
        
          player.disconnect().then(success => {
            if (success) {
              player.removeListener('ready');
              playerUpdateUi('none');
              resetSession();
            }
          });
        } catch (error) {
          console.error('Error disconnecting player:', error);
        }
      } else {
        playerUpdateUi('none');
        resetSession();
      }
    });
    
    // Keyboard controls
    let togglePlayThrottleTimeout;
    document.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Space') {
        event.preventDefault();
        clearTimeout(togglePlayThrottleTimeout);
        togglePlayThrottleTimeout = setTimeout(() => {
          player.togglePlay();
        }, 80);
      }
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        toggleFullscreen();
      }
    });
    
    function toggleFullscreen() {
      if (document.fullscreenElement) {
        backGradientScale = 2.0;
        backGradientImg.style.scale = backGradientScale;
        document.exitFullscreen();
      } else {
        backGradientScale = 2.8;
        backGradientImg.style.scale = backGradientScale;
        document.body.requestFullscreen();
      }
    }
  
    // Leave window
    window.addEventListener('beforeunload', () => {
      if (isPlayerReady) {
        player.removeListener('ready');
        player.disconnect();
      }
      
      if (backGradientImg) backGradientImg.style.scale = 0.2;
      
      controllerAbort.abort();
    });
  } catch (error) {
    console.error('Error in onSpotifyWebPlaybackSDKReady:', error);
  }
};

// ====== Functions ======
async function fetchAccessToken() {
  const accessToken = sessionStorage.getItem('spotifyAccessToken');

  if (accessToken) {
    return Promise.resolve(accessToken);
  }
}

async function spotifyApiRequest(endpoint) {
  if (!endpoint) return Promise.reject(new Error('No endpoint specified'));
  if (!isOnline()) return Promise.reject(new Error('You are offline. Please check your internet connection.'));

  try {
    await rateLimiter();

    const token = await fetchAccessToken();

    if (!token) {
      return Promise.reject(new Error('Failed to retrieve access token'));
    }

    const response = await fetch(`https://api.spotify.com/v1${endpoint}`, {
      cache: 'default',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.status === 401) {
      response.message == 'The access token expired';
      reloadToken();
      return Promise.reject(new Error('Invalid access token. Reloading...'));
    } else if (response.status === 429) {
      return Promise.reject(new Error('Rate limit exceeded. Please try again later.'));
    }

    if (!response.ok) {
      return Promise.reject(new Error(`Failed to retrieve data from endpoint: ${endpoint}`));
    }

    if (response.ok && response.status !== 204) {
      const data = await response.json();
      return Promise.resolve(data);
    } else {
      return Promise.resolve(null);
    }
  } catch (error) {
    console.error('Error:', error);
    playerUpdateUi('none');
    return Promise.reject(error);
  }
}

function handlePlayerError(event) {
  try {
    const type = event.type;
    const message = event?.error?.message || event?.message;

    if (!type) return;

    switch (type) {
      case 'initialization_error':
        console.error('Initialization error:', message);
        break;
      case 'authentication_error':
        console.error('Authentication error:', message);
        console.log('failed', event.error.message);
        if (message === 'Authentication failed') {
          reloadToken();
          resetSession();
        }
        break;
      case 'account_error':
        displayStatusText('Error: ' + message);
        //functionality is restricted to premium users only
        console.error('Account error:', message);
        break;
      case 'playback_error':
        displayStatusText('Error: ' + message);
        //The operation is not allowed.
        console.error('Playback error:', message);
        if (message === 'The operation is not allowed.') {
          reloadToken();
        }
        break;
      case 'connect_error':
        console.error('Connection error:', message);
        if (message === 'false') {
          resetSession();
        }
        break;
      case 'autoplay_failed':
        console.log('Autoplay is not allowed by the browser autoplay rules');
        break;
      default:
        console.error('Unknown error type:', type, message);
        break;
    }
  } catch (error) {
    console.error('Error:', error);
  }
}


const rateLimiter = (() => {
  const RATE_LIMIT = 180;  // Number of allowed requests (Clamped within the limit from Spotify API)
  const RATE_LIMIT_WINDOW = 30000;  // Time window in milliseconds (e.g., 30 seconds)
  
  let requestCount = 0;
  let firstRequestTime = Date.now();

  return async () => {
    const currentTime = Date.now();
    
    if (currentTime - firstRequestTime > RATE_LIMIT_WINDOW) {
      // Reset the rate limit window
      firstRequestTime = currentTime;
      requestCount = 0;
    }

    if (requestCount >= RATE_LIMIT) {
      updateTimer = 18; // Set update timer to 18 seconds
      return Promise.reject(new Error('Rate limit exceeded. Please try again later.'));
    }

    requestCount++;
    return Promise.resolve();
  };
})();

async function resetSession(redirect = true) {
  try {
    controllerAbort.abort();
    sessionStorage.removeItem('spotifyAccessToken');
    sessionStorage.removeItem('localDeviceId');

    const response = await fetch('callback.php?action=logout', { method: 'GET' });
    if (!response.ok) {
      throw new Error('Failed to logout: ' + response.status + ' ' + response.statusText);
    }
    
    if (redirect) {
      window.location.href = "index.html";
    }
  } catch (error) {
    console.error(error.message);
  }
}

async function reloadToken() {
  try {
    sessionStorage.removeItem('spotifyAccessToken');
    const token = await fetchAccessToken({ cache: 'no-store' });

    if (!token) {
      console.error('No access token found');
      return false;
    }
    return true;
    
  } catch (error) {
    console.error('Failed to reload access token:', error);
    return false;
  }
}

// Function to set body background as album
function setBackgroundImage(url)  {
  const backGradientImg = document.getElementById('albumCoverbackground');
  
  if (backGradientImg && url) {
    // Validate the URL format
    if (typeof url !== 'string' || !url.startsWith('https://i.scdn.co/')) {
      console.warn(`Invalid image URL: ${url}. Should start with: https://i.scdn.co/`);
      return;
    }

    if (backGradientScale === 0.2) {
      backGradientScale = 2.0;
      backGradientImg.style.scale = backGradientScale;
    }

    backGradientImg.style.backgroundImage = `url(${url})`;
  }
}

function displayStatusText(text) {
  const trackName = document.getElementById('track-name');
  if (trackName && text) {
    trackName.textContent = text;
  }
}

function playerUpdateUi(visabillity) {
  const playPauseBtn = document.getElementById('play-pause-btn');
  const nextBtn = document.getElementById('next-btn');
  const prevBtn = document.getElementById('prev-btn');
  const trackSeek = document.getElementById('seek-range');
  const volumeBar = document.getElementById('volume-bar');
  const trackName = document.getElementById('track-name');
  const trackArtist = document.getElementById('track-artist');
  const trackCover = document.getElementById('track-cover');
  const songCurrentTime = document.getElementById('song-current-time');
  const songTimeMax = document.getElementById('song-end-time');
  
  if(visabillity === 'full') {
    [playPauseBtn, nextBtn, prevBtn, trackSeek, volumeBar, songCurrentTime, songTimeMax].forEach(btn => btn.style.display = 'initial');
  }
  if (visabillity === 'half') {
    [playPauseBtn, nextBtn, prevBtn, trackSeek, volumeBar, songCurrentTime, songTimeMax].forEach(btn => btn.style.display = 'none');
  }
  if (visabillity === 'none') {
    [playPauseBtn, nextBtn, prevBtn, trackSeek, volumeBar, songCurrentTime, songTimeMax].forEach(btn => btn.style.display = 'none');
    trackName.textContent = '';
    trackArtist.textContent = '';
    trackCover.src = defaultAlbumCover;  // Placeholder image
  }
}

// Get current track
async function getAndDisplayTrackInfo() {
  try {
    if (!isOnline()) return false;
    
    const token = await fetchAccessToken();

    if (!token) {
      console.error('No access token found');
      return false;
    }

    const [currentlyPlaying, playbackState] = await Promise.all([
      spotifyApiRequest('/me/player/currently-playing', token),
      spotifyApiRequest('/me/player', token)
    ]);

    if (!currentlyPlaying || !currentlyPlaying.item) {
      console.warn('No track data available.');
      return false;
    }

    const trackName = document.getElementById('track-name');
    const trackArtist = document.getElementById('track-artist');
    const trackCover = document.getElementById('track-cover');
    const imgOuter = document.getElementById('img-container');

    const localDeviceId = sessionStorage.getItem('localDeviceId');
    const currentDeviceId = playbackState.device.id;
    const useLinks = false; // Set to true to link to Spotify artist, album, and track

    let name = '';
    let artist = '';
    let imageUrl = '';
    let artistUri = '';
    let albumUri = '';
    let trackUri = '';

    if (!localDeviceId || !currentDeviceId) {
      console.error('Local device ID or current device ID not found.');
      // Reset
      return false;
    }

    if (localDeviceId === currentDeviceId) {
      playerUpdateUi('full');
    }
    if (localDeviceId !== currentDeviceId) {
      playerUpdateUi('half');
    }

    if (currentlyPlaying.item.type === 'track') {
      name = currentlyPlaying.item.name;
      artist = currentlyPlaying.item.artists.map(artist => artist.name).join(', ');
      imageUrl = currentlyPlaying.item.album.images[0].url;
      artistUri = currentlyPlaying.item.artists[0].uri.split(':')[2];
      albumUri = currentlyPlaying.item.album.uri.split(':')[2];
      trackUri = currentlyPlaying.item.uri.split(':')[2];
      imageUrl.loading = 'eager';
      /* Not available yet (Podcasts)...
      } else if (currentlyPlaying.item.type === 'episode') {
      displayStatusText('Currently doesnt support podcast episodes.');
      name = currentlyPlaying.item.name;
      artist = currentlyPlaying.item.show.publisher;
      imageUrl = currentlyPlaying.item.images[0].url;
      trackUri = currentlyPlaying.item.uri.split(':')[2];*/
    } else {
      if (currentlyPlaying.currently_playing_type === 'episode') {
        displayStatusText('Currently doesnt support podcast episodes.');
      } else {
        displayStatusText('Unsupported content type');
      }
      console.warn('Unsupported content type');
      return false;
    }

    if (useLinks) {
      trackName.innerHTML = `<a href="https://open.spotify.com/${currentlyPlaying.item.type}/${trackUri}" target="_blank" rel="alternate, noreferrer">${name}</a>`;
      trackArtist.innerHTML = artistUri ? `<a href="https://open.spotify.com/artist/${artistUri}" target="_blank" rel="alternate, noreferrer">${artist}</a>` : artist;
      imgOuter.innerHTML = albumUri ? `<a href="https://open.spotify.com/album/${albumUri}" target="_blank" rel="alternate, noreferrer"><img src="${imageUrl}" id="track-cover"/></a>` : `<img src="${imageUrl}" id="track-cover"/>`;
    } else {
      trackName.textContent = name;
      trackArtist.textContent = artist;
      trackCover.src = imageUrl || defaultAlbumCover;  // Placeholder image
    }
    setBackgroundImage(imageUrl);
    return true;

  } catch (error) {
    console.error('Failed to get track info:', error);
    return false;
  }
}

// Get and show devices
async function getAndShowDevices(localDeviceId) {
  try {
    if (!isOnline()) throw new Error('No internet connection.');
    
    const token = await fetchAccessToken();
  
    if (!token) {
      console.error('No access token found');
      return;
    }

    const [deviceData, playbackState] = await Promise.all([
      spotifyApiRequest('/me/player/devices', token),
      spotifyApiRequest('/me/player', token)
    ]);

    if (!deviceData || !deviceData.devices || !playbackState || !playbackState.device) {
      console.warn('No devices found');
      displayStatusText('Not connected');
      return;
    }

    if (!localDeviceId || localDeviceId === null) {
      localDeviceId = sessionStorage.getItem('localDeviceId');
    }

    const currentDeviceId = playbackState.device.id;
    const isPlaying = playbackState.is_playing;

    const deviceSelect = document.getElementById('deviceSelect');
    deviceSelect.innerHTML = '';

    deviceData.devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.id || '';
      option.textContent = device.name;
      if (device.id === currentDeviceId) {
        option.selected = true;
      }
      
      deviceSelect.appendChild(option);
    });

    if (localDeviceId === currentDeviceId && isPlaying) {
      playerUpdateUi('full');
    }

    deviceSelect.onchange = () => {
      const selectedDeviceId = deviceSelect.value;
      transferPlayback(selectedDeviceId);
    };
  } catch (error) {
    resetSession(true);
    console.error('Failed to get devices:', error);
  }
}

// Function to transfer playback to selected device
async function transferPlayback(deviceId) {
  try {
    if (!isOnline()) throw new Error('You are offline. Please check your internet connection.');
    if (!deviceId) throw new Error('No device ID specified for playback transfer.');

    const token = await fetchAccessToken();
  
    if (!token) {
      console.error('No access token found');
      return;
    }
    
    // Check current playback state
    const playbackState = await spotifyApiRequest('/me/player', token);
    const isPlaying = playbackState.is_playing;

    const currentDeviceId = playbackState.device.id;
    if (deviceId !== currentDeviceId) {
      displayStatusText('Transferring playback...');
      console.log(`Transferring playback from ${currentDeviceId} to ${deviceId}`);
    }
    
    // Transfer playback only if necessary
      const response = await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          device_ids: [deviceId],
          play: isPlaying
        })
      });

      if (response.status === 204) {
        if (deviceId !== currentDeviceId) {
          playerUpdateUi('half');
        }
        console.log('Playback transferred successfully to device:', deviceId);
      } else {
        console.error('Failed to transfer playback', response);
      }
  } catch (error) {
    console.error('Error transferring playback:', error);
  }
}

// Function to transfer playback to another device when closing
async function transferPlaybackToAnotherDevice() {
  try {
    if (!isOnline()) throw new Error('You are offline. Please check your internet connection.');
    
    const token = await fetchAccessToken();
  
    if (!token) {
      console.error('No access token found');
      return;
    }

    const playbackState = await spotifyApiRequest('/me/player', token);
    const currentDeviceId = playbackState.device.id;
    const isPlaying = playbackState.is_playing;
    const deviceData = await spotifyApiRequest('/me/player/devices', token);
    const otherDevice = deviceData.devices.find(device => device.id !== currentDeviceId);

    if (otherDevice) {
      if (isPlaying) {
        await transferPlayback(otherDevice.id);
      }
    } else {
      console.log('No other devices found to transfer playback to.');
    }
  } catch (error) {
    console.error('Failed to transfer playback to another device:', error);
  }
}

function skipSongUpdateUi() {
  if (skipSongTimer) {
    clearTimeout(skipSongTimer);
  }
  skipSongTimer = setTimeout(() => {
    getAndDisplayTrackInfo();
  }, 1900);
}
