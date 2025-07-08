<?php
// callback.php
header('Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, DELETE, PATCH');
header('Access-Control-Allow-Credentials: true');

error_reporting(E_ALL);
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);

if (session_status() !== PHP_SESSION_ACTIVE) {
  session_start();
}

// Spotify API credentials
$client_id = 'your_client_id_here'; // Replace with your actual client ID
$client_secret = 'your_client_secret_here'; // Replace with your actual client secret
$redirect_url = 'path-to-your-redirect-url-callback.php'; // Replace with your actual redirect URL

// Redirect to Spotify authorization URL
if (!isset($_GET['code'])) {
  $rawscope = 'user-read-playback-state user-modify-playback-state user-read-currently-playing streaming app-remote-control';
  $scope = urlencode($rawscope);
  $state = bin2hex(openssl_random_pseudo_bytes(16));
  $_SESSION['oauth2state'] = $state;
  $auth_url = 'https://accounts.spotify.com/authorize/?' .
    'response_type=code' .
    '&client_id=' . $client_id .
    '&scope=' . $scope .
    '&redirect_uri=' . urlencode($redirect_url) .
    '&state=' . $state;
  header('Location: ' . $auth_url);
  exit;
}

// Validate state
if (isset($_SESSION['oauth2state'])) {
  if (empty($_GET['state']) || ($_GET['state'] !== $_SESSION['oauth2state'])) {
    http_response_code(401);
    unset($_SESSION['oauth2state']);
    errorMessage('Invalid state. Please try again.');
    exit;
  }
}

// Exchange authorization code for access token
if (isset($_GET['code']) && !empty($_GET['code']) && !isset($_SESSION['access_token'])) {
  $code = $_GET['code'];
  $token_url = 'https://accounts.spotify.com/api/token';
  $token_data = array(
    'grant_type' => 'authorization_code',
    'code' => $code,
    'redirect_uri' => $redirect_url,
    'client_id' => $client_id,
    'client_secret' => $client_secret
  );

  $ch = curl_init($token_url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($token_data));
  curl_setopt($ch, CURLOPT_HTTPHEADER, array(
    'Content-Type: application/x-www-form-urlencoded'
  ));

  $response = curl_exec($ch);
  curl_close($ch);

  $token_data = json_decode($response, true);
  $access_token = $token_data['access_token'] ?? null;

  if (!$access_token) {
    errorMessage('Unable to obtain access token.');
    exit;
  } else {
    $_SESSION['access_token'] = $access_token;
    header('Location: player.html');  // Redirect to your front-end application
    exit;
  }
} else {
  errorMessage('Access token not found.');
  exit;
}

// Function to display error messages
function errorMessage($message) {
  header('Content-Type: text/html; charset=UTF-8');
  echo "<p style='text-align: center; font-size: 20px; color: maroon'>Error: ".htmlspecialchars($message, ENT_QUOTES)."</p>";
  exit;
}
?>