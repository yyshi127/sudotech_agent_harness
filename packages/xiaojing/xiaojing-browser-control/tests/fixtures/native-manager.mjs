/** External browser stand-in for operator-settings process and ownership tests. */
process.stdout.write('ready\n')
process.stdin.resume()
process.stdin.once('end', () => process.exit(0))
