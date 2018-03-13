let path = require('path');
let config = {
    host: 'localhost',// 监听主机
    port: 8080,// 主机端口号
    root: path.resolve(__dirname, '..')// 静态文件根目录
}
module.exports = config;