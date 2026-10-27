const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: './ui/configPage.js',
  output: {
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true, 
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './ui/index.html'
    })
  ]
};