import axios from "axios";
import readline from "readline";
import fs from 'fs';
import ProgressBar from 'progress';
import { exec } from 'child_process'


const nombre = `

██████╗░██╗██╗░░░░░██╗░░░████████╗██╗░░░██╗
██╔══██╗██║██║░░░░░██║░░░╚══██╔══╝██║░░░██║
██████╦╝██║██║░░░░░██║░░░░░░██║░░░╚██╗░██╔╝
██╔══██╗██║██║░░░░░██║░░░░░░██║░░░░╚████╔╝░
██████╦╝██║███████╗██║██╗░░░██║░░░░░╚██╔╝░░
╚═════╝░╚═╝╚══════╝╚═╝╚═╝░░░╚═╝░░░░░░╚═╝░░░

`;

axios.defaults.headers = {
    referer: ' https://www.bilibili.tv/', cookie: process.env.COOKIE
  }

const obtenerValorDespuesDeVideo = (enlace) => {
    const urlParseada = new URL(enlace);
    const pathSplit = urlParseada.pathname.split('/');

    if (enlace.includes('/video/')) {
        const indiceVideo = pathSplit.indexOf('video');
        return pathSplit[indiceVideo + 1];
    } else if (enlace.includes('/play/')) {
        const numerosDespuesDePlay = pathSplit.filter(segmento => /^\d+$/.test(segmento));

        if (numerosDespuesDePlay.length >= 2) {
            return numerosDespuesDePlay[1];
        } else if (numerosDespuesDePlay.length === 1) {
            console.log('Only one number found after /play/. That value will be used.');
            return numerosDespuesDePlay[0];
        } else {
            console.log('Not enough numbers found after /play/');
            return null;
        }
    } else {
        console.log('Unsupported link type.');
        return null;
    }
};

const obtenerUrlDeVideoYAudio = async (valor, calidadDeseada = 64) => {
    const regexVideo = /^\d{4,8}$/
    if (valor) {
        let urlApi;

        if (regexVideo.test(valor)) {
            urlApi = `https://api.bilibili.tv/intl/gateway/web/playurl?ep_id=${valor}&device=wap&platform=web&qn=64&tf=0&type=0`;
        } else {
            urlApi = `https://api.bilibili.tv/intl/gateway/web/playurl?s_locale=en_US&platform=web&aid=${valor}&qn=120`;
        }

        try {
            const respuesta = await axios.get(urlApi, { credentials: "include" });
            const datos = respuesta.data;
        
            if (!datos || !datos.data || !datos.data.playurl) {
                console.log('Server response does not contain the expected structure.');
                return null;
            }
        
            let urlVideo = null;
            let urlAudio = null;
        
            for (const videoInfo of datos.data.playurl.video) {
                const videoResource = videoInfo.video_resource || {};
                const streamInfo = videoInfo.stream_info || {};
                const calidadVideo = streamInfo.quality || 80;
        
                if (calidadVideo === 80 && videoResource.url.trim() !== '') {
                    urlVideo = videoResource.url || '';
                    break;
                } else if (calidadVideo === 64 && videoResource.url.trim() !== '') {
                    urlVideo = videoResource.url || '';
                    break;
                } else if (calidadVideo === 32 && videoResource.url.trim() !== '') {
                    urlVideo = videoResource.url || '';
                    break;
                }
            }

            const audioInfoLista = datos.data.playurl.audio_resource || [];

            if (audioInfoLista.length > 0) {
                const audioInfo = audioInfoLista[0]; 
                const calidadAudio = audioInfo.quality || 0;
                urlAudio = calidadAudio >= calidadDeseada ? audioInfo.url || '' : null;
            }

            if (urlVideo !== null && urlAudio !== null) {
                return { urlVideo, urlAudio };
            } else {
                console.log(`URL for video or audio with quality ${calidadDeseada} or 64 not found..`);
                return null;
            }
        } catch (error) {
            console.log(`Error getting video and audio URL: ${error.message}`);
            return null;
        }
    } else {
        console.log('No value provided after /video/ or /play/');
        return null;
    }
};

const descargarVideoYAudio = async (enlace, directorioDestino = '.') => {
    const valorDespuesDeVideo = obtenerValorDespuesDeVideo(enlace);

    if (valorDespuesDeVideo) {
        const { urlVideo, urlAudio } = await obtenerUrlDeVideoYAudio(valorDespuesDeVideo);
        if (urlVideo && urlAudio) {
            console.log('¡Links found! ');

            const nombreArchivoVideo = `${directorioDestino}/${Math.floor(Math.random() * 1000000)}_video.m4v`;
            const nombreArchivoAudio = `${directorioDestino}/${Math.floor(Math.random() * 1000000)}_audio.mp4`;

            await descargarArchivo(urlVideo, nombreArchivoVideo);
            await descargarArchivo(urlAudio, nombreArchivoAudio);

            const nombreArchivoFinal = `${directorioDestino}/${Math.floor(Math.random() * 1000000)}_final.mp4`;
            const comandoFFmpeg = `ffmpeg -i ${nombreArchivoVideo} -i ${nombreArchivoAudio} -vcodec copy -acodec copy -f mp4 ${nombreArchivoFinal}`;
            await ejecutarComandoShell(comandoFFmpeg);

            console.log(`Files linked as: ${nombreArchivoFinal} \n`);

            await eliminarArchivo(nombreArchivoVideo);
            await eliminarArchivo(nombreArchivoAudio);

            console.log('Video and audio files deleted.');
        } else {
            console.log('URL for the desired quality not found.');
        }
    } else {
        console.log('Link does not contain the expected "video/" or "play/" part.');
    }
};

const descargarArchivo = async (url_archivo, nombre_archivo) => {
    try {
        const response = await axios.get(url_archivo, { responseType: 'stream' });

        const totalBytes = parseInt(response.headers['content-length'], 10);
        let receivedBytes = 0;
        let lastReceivedBytes = 0;

        const bar = new ProgressBar(`Downloading ${nombre_archivo} [:bar] :percent :etas`, {
            complete: '=',
            incomplete: ' ',
            width: 20,
            total: totalBytes
        });

        const writableStream = fs.createWriteStream(nombre_archivo);

        response.data.on('data', (chunk) => {
            receivedBytes += chunk.length;
            bar.tick(chunk.length); 
            lastReceivedBytes = receivedBytes;
        });

        response.data.pipe(writableStream);

        await new Promise((resolve, reject) => {
            writableStream.on('finish', resolve);
            writableStream.on('error', reject);
        });

        console.log(`File downloaded as:  ${nombre_archivo} \n`);
        return nombre_archivo;
    } catch (error) {
        console.error(`Error during file download:  ${error.message}`);
        return null;
    }
};

const eliminarArchivo = async (nombreArchivo) => {
    try {
        await fs.promises.unlink(nombreArchivo);
    } catch (error) {
       console.log(`Error deleting file ${nombreArchivo}: ${error}`);
   }
};

const ejecutarComandoShell = async (comando) => {
    return new Promise((resolve, reject) => {
        exec(comando, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error executing command: ${error.message}`);
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log(nombre) 
  console.log('                     https://github.com/jjaruna \n \n')
  rl.question('Enter the link: ', (enlaceOriginal) => {
  
    const valorDespuesDeVideo = obtenerValorDespuesDeVideo(enlaceOriginal);

const directorioDestino = './Downloads';

if (!fs.existsSync(directorioDestino)) {
    fs.mkdirSync(directorioDestino);
}

const ejecutarDescarga = async () => {
    if (valorDespuesDeVideo) {
        const urlVideo = await obtenerUrlDeVideoYAudio(valorDespuesDeVideo);
        if (urlVideo) {
            await descargarVideoYAudio(enlaceOriginal, directorioDestino);
        } else {
            console.log('URL not found for desired quality.');
        }
    } else {
        console.log('The link does not contain the expected "video/" part.');
    }
};

ejecutarDescarga();

rl.close();

});