'use strict';

const {normalizeTheme} = require('./dashboard.cjs');
const SCHEMES = {warm: 'moonstone', night: 'obsidian'};

function applyAppPalette(doc, settings) {
  const body = doc.body;
  if (!body) return;
  if (!settings) {
    delete body.dataset.tdDayColor;
    delete body.dataset.tdNightColor;
    return;
  }
  const {color, nightColor} = normalizeTheme(settings.theme);
  body.dataset.tdDayColor = color;
  body.dataset.tdNightColor = nightColor;
}

function selectScheme(app, scheme) {
  if (!Object.hasOwn(SCHEMES, scheme) || typeof app.changeTheme !== 'function') return false;
  app.changeTheme(SCHEMES[scheme]);
  return true;
}

function themeIsActive(doc) {
  return doc.defaultView?.getComputedStyle(doc.body).getPropertyValue('--congrong-theme-active').trim() === '1';
}

function usesThemeHome(active, settings) {
  return active && settings.congrongHome !== false;
}

module.exports = {applyAppPalette, selectScheme, themeIsActive, usesThemeHome};
