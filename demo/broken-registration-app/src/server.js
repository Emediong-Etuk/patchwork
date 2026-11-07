"use strict";
const { createServer } = require("./http/app");

const port = Number(process.env.PORT || 4100);
createServer().listen(port, () => {
  console.log(`account service listening on :${port}`);
});
