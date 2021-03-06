/**
 * Verifies that all urls point to actual resources. This is necessary while
 * CloudFront has github pages as the origin, and prevents a redirect to
 * okta.github.io in this scenario:
 *
 * https://d.o.c/blog -> https://d.o.c./blog.html -> 301 https://okta.github.io/blog/
 *
 * In this case, the url should be https://d.o.c./blog/ to prevent the redirect.
 */

const path = require('path');
const fs = require('fs');
const readdir = require('recursive-readdir');
const chalk = require('chalk');

const linkExpr = '<(?:a|area|base|link)[^>]*href\s*=\s*"([^"]+)"';
const globalLinkRe = new RegExp(linkExpr, 'g');
const localLinkRe = new RegExp(linkExpr);
const linkExtRe = new RegExp('/[^/]+\\.[a-z]+$');
const trailingSlashRe = new RegExp('/$');
const hashRe = new RegExp('#.*$');

function header(str) {
  console.log(`\n${chalk.bold(str)}`);
}

function error(str) {
  console.log(chalk.bold.red(str));
}

async function getFiles(dir) {
  const files = await readdir(dir);
  const filesToCheck = [];
  const fileMap = {};

  for (let file of files) {
    const relative = file.replace(dir, '');
    fileMap[relative] = true;
    // Only check .html files that are not autogenerated SDK docs
    if (!file.includes('/docs/sdk/') && path.extname(file) === '.html') {
      filesToCheck.push({ orig: file, relative });
    }
  }

  return { filesToCheck, fileMap };
}

function findBadLinks(file, fileMap) {
  const contents = fs.readFileSync(file.orig, 'utf8');
  const base = path.dirname(file.relative);
  return (contents.match(globalLinkRe) || [])
    // Map href="/foo" to /foo
    .map(res => res.match(localLinkRe)[1])

    // Process link:
    // - Remove hash fragments
    // - Prepend path if relative
    // - Remove hardcoded baseUrl
    .map((link) => {
      let prepped = link.replace(hashRe, '').replace('https://developer.okta.com', '');
      if (prepped && prepped[0] !== '/' && !prepped.includes(':')) {
        prepped = path.resolve(base, prepped);
      }
      return { orig: link, prepped };
    })

    // Remove links that are only hash fragments
    .filter(link => link.prepped !== '')

    // Remove links with file extensions - these are okay
    .filter(link => !linkExtRe.test(link.prepped))

    // Remove links ending in a trailing slash - these are okay
    .filter(link => !trailingSlashRe.test(link.prepped))

    // Remove external links
    .filter(link => !link.prepped.includes('://'))

    // Remove non http protocols (i.e. mailto: and tel:)
    .filter(link => !link.prepped.includes('mailto:') && !link.prepped.includes('tel:'))

    // Remove links with no extension that resolve to an html file
    .filter(link => !fileMap[`${link.prepped}.html`]);
}

async function run(dir) {
  const files = await getFiles(path.resolve(dir));
  const badFiles = [];
  header(`Found ${files.filesToCheck.length} files to check in ${dir}`);
  for (let file of files.filesToCheck) {
    console.log(`  Checking ${file.relative}`);
    const links = findBadLinks(file, files.fileMap);
    if (links.length > 0) {
      links.forEach(link => console.log(`    └─ Invalid link: ${link.orig}`));
      badFiles.push({ file, links });
    }
  }

  if (badFiles.length > 0) {
    let linkCount = 0;
    error('\nProblems found!\n');
    for (let i = 0; i < badFiles.length; i++) {
      const badFile = badFiles[i];
      linkCount += badFile.links.length;
      error(`${i+1}. ${badFile.file.relative}`);
      badFile.links.forEach(link => error(`    └─ Invalid link: ${link.orig}`));
    }
    error(`
Found ${badFiles.length} files with ${linkCount} bad links.

To Fix:
1. Find the source .md or .html files - this script is run on the built .html files
2. Search in the source file for the problem links
3. Add a trailing slash, or reference the file directly.

For example, for '/blog', use either '/blog/' or '/blog/index.html'.
    `);
    process.exit(1);
  } else {
    console.log(chalk.bold.green('\nNo problems found!\n'));
  }
}

// Run ------------------------------------------------------------------------

header(`Checking for missing trailing slashes (${__filename})`);
run(path.resolve(__dirname, '../dist'));
