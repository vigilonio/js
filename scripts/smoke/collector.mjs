// Minimal OTLP/HTTP receiver. Prints its port on stdout and appends one JSON
// line per received export to collector.log, recording which span markers
// appear in the (protobuf) body. Span names and attribute values are stored
// as plain UTF-8 inside the protobuf, so a substring check is enough here.
import http from "node:http";
import fs from "node:fs";

const MARKERS = {
  httpServerSpan: "GET /hello",
  expressSpan: "request handler",
};

http
  .createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("latin1");
      const markers = Object.entries(MARKERS)
        .filter(([, needle]) => body.includes(needle))
        .map(([key]) => key);
      fs.appendFileSync(
        "collector.log",
        JSON.stringify({ path: req.url, bytes: body.length, markers }) + "\n",
      );
      res.writeHead(200, { "content-type": "application/x-protobuf" });
      res.end();
    });
  })
  .listen(0, "127.0.0.1", function () {
    process.stdout.write(String(this.address().port) + "\n");
  });
