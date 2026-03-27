export default {
  '*.{js,jsx,ts,tsx,json,css,md}': ['prettier --write'],
  '*.{js,jsx,ts,tsx}': ['eslint --fix --max-warnings 0'],
};
