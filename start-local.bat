@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
node seed.js
start http://localhost:3000
node app.js
