const fs = require('fs');
const url = require('url');
const zlib = require('zlib'); // node中的压缩模块
const http = require('http');
const path = require('path');
const mime = require('mime');
const chalk = require('chalk'); // 使命令行有颜色一个第三方的库
const config = require('./config');
const { promisify, inspect } = require('util');
const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);

const debug = require('debug')('statiserver:app');// 名称有特点 两部分组成 第一部分是项目名 'statiserver' 第二部分是模块名 'app'

const handlebars = require('handlebars'); // 模版引擎
function list () {
    let tmpl = fs.readFileSync(path.resolve(__dirname,'template','list.html'),'utf8');
    return handlebars.compile(tmpl)
}
class Server {
    constructor(argv) {
        this.list = list()
        this.config = Object.assign({}, config, argv)
    }
    start() {
        let server = http.createServer();
        server.on('request', this.request.bind(this));
        let url = `http://${config.host}:${config.port}`;

        server.listen(this.config.port, ()=>{
            debug(`server started at ${chalk.green(url)}`);
        })
    }
    /*静态文件服务器*/
    async request(req,res) {
        // 先取到客户端想访问的路径
        let { pathname } = url.parse(req.url);
        if (pathname == '/favicon.ico') {
            return this.sendError('not favicon.ico',req,res)
        }
        let filePath = path.join(this.config.root, pathname);
        try{
            // 判断访问的路径是文件夹 还是文件
           let statObj = await stat(filePath);
           if (statObj.isDirectory()) {// 如果是目录的话 应该显示目录下面的文件列表 否则显示文件内容
               let files = await readdir(filePath);
               files = files.map(file => ({
                   name: file,
                   url: path.join(pathname, file)
               }))
                let html = this.list({
                    title: pathname,
                    files,
                });
               res.setHeader('Content-Type', 'text/html');
               res.end(html)
           } else {
               this.sendFile(req, res, filePath, statObj)
           }
        }catch (e) {
            debug(inspect(e)); // 把一个对象转化为字符串，因为有的tosting会生成object object
            this.sendError(e, req, res);
        }
    }
    /* send file to browser*/
    sendFile (req, res, filePath, statObj) {
        if(this.isCache(req, res, filePath, statObj)){
            return;
        }
        res.statusCode = 200; // 可以省略
        res.setHeader('Content-Type', mime.getType(filePath) + ';charset=utf-8');
        let encoding = this.compression(req,res);
        if(encoding) {
            this.rangeTransfer(req, res, filePath, statObj).pipe(encoding).pipe(res)
        } else {
            this.rangeTransfer(req, res, filePath, statObj).pipe(res)
        }
    }
    /* handle error*/
    sendError (error, req, res) {
        res.statusCode = 500;
        res.end(`${error.toString()}`);
    }
    /*cache 是否走缓存*/
    isCache (req, res, filePath, statObj) {
        let ifNoneMatch = req.headers['if-none-match'];
        let ifModifiedSince = req.headers['if-modified-since'];
        res.setHeader('Cache-Control','private,max-age=10');
        res.setHeader('Expires',new Date(Date.now() + 10*1000).toGMTString);
        let etag = statObj.size;
        let lastModified = statObj.ctime.toGMTString();
        res.setHeader('Etag',etag)
        res.setHeader('Last-Modified',lastModified);
        if(ifNoneMatch && ifNoneMatch != etag) {
            return false
        }

        if(ifModifiedSince && ifModifiedSince != lastModified){
            return false
        }
        if(ifNoneMatch || ifModifiedSince) {
            res.writeHead(304);
            res.end();
            return true
        } else {
            return false
        }
    }
    /*broken-point continuingly-transferring  断点续传*/
    rangeTransfer (req, res, filePath, statObj) {
        let start = 0;
        let end = statObj.size-1;
        let range = req.headers['range'];
        if(range){
            res.setHeader('Accept-range','bytes');
            res.statusCode=206// 返回整个内容的一块
            let result = range.match(/bytes=(\d*)-(\d*)/);
            start = isNaN(result[1]) ? start : parseInt(result[1]);
            end = isNaN(result[2]) ? end : parseInt(result[2]) - 1
        }
        return fs.createReadStream(filePath, {
            start,
            end
        })
    }
    /*compression 压缩*/
    compression (req, res) {
        let acceptEncoding = req.headers['accept-encoding'];//163.com
        if(acceptEncoding) {
            if(/\bgzip\b/.test(acceptEncoding)){
                res.setHeader('Content-Encoding','gzip');
                return zlib.createGzip();
            } else if(/\bdeflate\b/.test(acceptEncoding)) {
                res.setHeader('Content-Encoding','deflate');
                return zlib.createDeflate();
            } else {
                return null
            }
        }
    }
}
module.exports = Server;