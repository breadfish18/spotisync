const fs = require('fs');
const path = require('path');

const ytdl = require('ytdl-core');
const NodeID3 = require('node-id3')
const fetch = require('node-fetch');
const sanitize = require('sanitize-filename');
const cliProgress = require('cli-progress');
const prompt = require('prompt');

const {
    Converter
} = require('ffmpeg-stream')

const SpotifyWebApi = require('spotify-web-api-node');
const YoutubeMusicApi = require('youtube-music-api');

const youtubeApi = new YoutubeMusicApi()
const spotifyApi = new SpotifyWebApi({
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
});

initalize().then(async () => {
    if (!fs.existsSync("config.json")) {
        prompt.start();
        prompt.message = null;
        const results = await prompt.get({
            properties: {
                playlist: {
                    description: "Please enter a spotify playlist URL"
                },
                path: {
                    description: "Please enter a path to store downloaded playlists"
                }
            }
        })
        results.playlist = results.playlist.substring(results.playlist.lastIndexOf('/') + 1)
        results.playlist = results.playlist.substring(0, results.playlist.indexOf('?'))
        fs.writeFileSync("config.json", JSON.stringify(results))
    }

    const config = JSON.parse(fs.readFileSync("config.json"))

    spotifyApi.getPlaylist(config.playlist)
        .then(async function (data) {
                data = data.body
                let tracks = data.tracks.items.map(track => {
                    return track.track
                })
                if (!fs.existsSync('tracks.json')) fs.writeFileSync('tracks.json', JSON.stringify([]))
                const downloaded = JSON.parse(fs.readFileSync('tracks.json'))
                tracks = tracks.filter(track => !downloaded.includes(track.uri))
                const progress = new cliProgress.SingleBar({
                    format: 'Downloading tracks [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}'
                }, cliProgress.Presets.legacy);
                progress.start(tracks.length)
                const downloadedTracks = []
                for (let i = 0; i < tracks.length; i++) {
                    const track = tracks[i];
                    const song = await spotifyToYoutube(track)
                    if (!fs.existsSync(path.join(__dirname, config.path, `./${data.name}`)))
                        fs.mkdirSync(path.join(__dirname, config.path, `./${data.name}`), {
                            recursive: true
                        })
                    await download(song.videoId, path.join(__dirname, config.path, `./${data.name}/${sanitize(track.name)}.mp3`), track)
                    downloadedTracks.push(track.uri)
                    progress.increment()
                    fs.writeFileSync('tracks.json', JSON.stringify(downloadedTracks))
                }
                progress.stop()
            },
            function (err) {
                console.log('Something went wrong!', err);
            });
})

async function download(id, file, meta) {
    return new Promise((resolve, reject) => {
        const converter = new Converter()

        const input = converter.createInputStream()
        const stream = ytdl(`https://youtu.be/${id}`, {
            quality: 'highestaudio',
        })
        stream.pipe(input)
        converter.createOutputToFile(file)
        converter.run().then(
            () => {
                writeMetadata(file, meta).then(() => {
                    resolve()
                })
            },
            (err) => {
                reject(err)
            }
        )
    })
}

async function writeMetadata(file, meta) {
    const res = await fetch(meta.album.images[0].url)
    const buffer = await res.buffer();
    const tags = {
        title: meta.name,
        artist: meta.artists[0].name,
        album: meta.album.name,
        image: {
            imageBuffer: buffer
        }
    }
    NodeID3.write(tags, file)
}

async function spotifyAuth() {
    return new Promise((resolve, reject) => {
        spotifyApi.clientCredentialsGrant().then((data) => {
            spotifyApi.setAccessToken(data.body['access_token']);
            resolve()
        }, (err) => {
            reject(err)
        })
    })
}

async function initalize() {
    await spotifyAuth()
    await youtubeApi.initalize()
}

async function spotifyToYoutube(track) {
    return new Promise(async (resolve, reject) => {
        let {
            content
        } = await youtubeApi.search(`${track.artists.map(artist => artist.name).join(' ')} ${track.name}`)

        if (content.length < 1) {
            content = (await youtubeApi.search(`${track.artists[0].name} ${track.name}`)).content
        }

        content = content.filter(track => track.type === 'song' || track.type === 'video')

        if (content.length < 1) {
            reject('No songs found')
        }

        if (content.length === 1) {
            resolve(content[0])
        }

        if (content[0].type === 'song') {
            resolve(content[0])
        } else if (content[1].type === 'song') {
            resolve(content[1])
        } else {
            console.warn(`Warning! No song found for spotify track ${track.name}`)
            resolve(content[0])
        }
    })
}