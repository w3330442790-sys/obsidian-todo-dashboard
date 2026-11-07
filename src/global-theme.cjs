'use strict';

const SCHEMES = {warm: 'moonstone', night: 'obsidian'};

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

module.exports = {selectScheme, themeIsActive, usesThemeHome};
