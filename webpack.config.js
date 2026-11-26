const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: './ui.js',
  output: {
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true, 
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html'
    })
  ]
};