import fs from "fs";
import readline from "readline";
import axios from "axios";
import ProgressBar from "progress";
import { exec } from "child_process";

const nombre = `

             ██████╗░██╗██╗░░░░░██╗░░░████████╗██╗░░░██╗
             ██╔══██╗██║██║░░░░░██║░░░╚══██╔══╝██║░░░██║
             ██████╦╝██║██║░░░░░██║░░░░░░██║░░░╚██╗░██╔╝
             ██╔══██╗██║██║░░░░░██║░░░░░░██║░░░░╚████╔╝░
             ██████╦╝██║███████╗██║██╗░░░██║░░░░░╚██╔╝░░
             ╚═════╝░╚═╝╚══════╝╚═╝╚═╝░░░╚═╝░░░░░░╚═╝░░░

`;

// ─── Cookies ────────────────────────────────────────────────────────────────

function cargarCookiesDesdeArchivo(rutaArchivo) {
    try {
        const data = fs.readFileSync(rutaArchivo, "utf-8");
        return data
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .join("; ");
    } catch (error) {
        console.error(`Error loading cookies: ${error.message}`);
        return "";
    }
}

// ─── URL Parsing ─────────────────────────────────────────────────────────────

/**
 * Soporta ejemplos como:
 * https://www.bilibili.tv/en/video/4795679137469952
 * https://www.bilibili.tv/en/play/2067971
 * https://www.bilibili.tv/en/play/2067971/12619483
 */
function obtenerInfoDelLink(enlace) {
    try {
        const url = new URL(enlace);
        const partes = url.pathname.split("/").filter(Boolean);

        const idxVideo = partes.indexOf("video");
        if (idxVideo !== -1) {
            const aid = partes[idxVideo + 1];
            if (aid && /^\d+$/.test(aid)) {
                return { ok: true, tipo: "video", aid, original: enlace };
            }
            return { ok: false, error: "The /video/ link does not contain a valid numeric ID." };
        }

        const idxPlay = partes.indexOf("play");
        if (idxPlay !== -1) {
            const numericParts = partes.slice(idxPlay + 1).filter(p => /^\d+$/.test(p));

            if (numericParts.length === 0)
                return { ok: false, error: "The /play/ link does not contain numeric IDs." };

            if (numericParts.length === 1) {
                return {
                    ok: true, tipo: "anime",
                    season_id: numericParts[0],
                    ep_id: numericParts[0],
                    original: enlace,
                    nota: "Only one numeric ID was found after /play/; using it as ep_id.",
                };
            }

            return {
                ok: true, tipo: "anime",
                season_id: numericParts[0],
                ep_id: numericParts[1],
                original: enlace,
            };
        }

        return { ok: false, error: 'Unsupported link type. Expected "/video/" or "/play/".' };
    } catch (error) {
        return { ok: false, error: `Invalid URL: ${error.message}` };
    }
}

function construirInfoApi(info) {
    if (!info?.ok) return null;

    if (info.tipo === "video") {
        return {
            tipo: "video",
            id: info.aid,
            //descripcion: `Detected normal video (aid=${info.aid})`,
        };
    }

    if (info.tipo === "anime") {
        return {
            tipo: "anime",
            id: info.ep_id,
            season_id: info.season_id ?? null,
            //descripcion: `Detected anime/episode (ep_id=${info.ep_id})`,
        };
    }

    return null;
}

// ─── API ─────────────────────────────────────────────────────────────────────

async function obtenerUrlDeVideoYAudio(apiInfo) {
    let urlApi;

    if (apiInfo.tipo === "anime") {
        urlApi = `https://api.bilibili.tv/intl/gateway/web/playurl?ep_id=${apiInfo.id}&device=wap&platform=web&qn=64&tf=0&type=0`;
    } else {
        urlApi = `https://api.bilibili.tv/intl/gateway/web/playurl?s_locale=en_US&platform=web&aid=${apiInfo.id}&qn=120`;
    }

    try {
        const respuesta = await axios.get(urlApi, { credentials: "include" });
        const datos = respuesta.data;

        if (!datos?.data?.playurl) {
            console.log("Server response does not contain the expected structure.");
            return null;
        }

        // Calidades de video en orden de preferencia
        const calidades = [112, 80, 64, 32];
        let urlVideo = null;

        for (const calidadObjetivo of calidades) {
            for (const videoInfo of datos.data.playurl.video) {
                const resource = videoInfo.video_resource ?? {};
                const calidad = videoInfo.stream_info?.quality ?? 0;

                if (calidad === calidadObjetivo && resource.url?.trim()) {
                    urlVideo = resource.url;
                    //console.log(`Video quality selected: ${calidadObjetivo}`); debugging quality
                    break;
                }
            }
            if (urlVideo) break;
        }

        const audioInfoLista = datos.data.playurl.audio_resource ?? [];
        let urlAudio = null;

        if (audioInfoLista.length > 0) {
            // Tomar el audio de mayor calidad disponible
            const mejorAudio = audioInfoLista.reduce((prev, curr) =>
                (curr.quality ?? 0) > (prev.quality ?? 0) ? curr : prev
            );
            urlAudio = mejorAudio.url?.trim() || null;
        }

        if (!urlVideo || !urlAudio) {
            console.log("Could not find video or audio URL.");
            return null;
        }

        return { urlVideo, urlAudio };
    } catch (error) {
        console.log(`Error fetching video/audio URL: ${error.message}`);
        return null;
    }
}

// ─── Descarga ─────────────────────────────────────────────────────────────────

async function descargarArchivo(urlArchivo, nombreArchivo) {
    try {
        const response = await axios.get(urlArchivo, { responseType: "stream" });
        const totalBytes = parseInt(response.headers["content-length"], 10);

        const bar = new ProgressBar(`Downloading ${nombreArchivo} [:bar] :percent :etas`, {
            complete: "=",
            incomplete: " ",
            width: 25,
            total: totalBytes,
        });

        const writableStream = fs.createWriteStream(nombreArchivo);
        response.data.on("data", chunk => bar.tick(chunk.length));
        response.data.pipe(writableStream);

        await new Promise((resolve, reject) => {
            writableStream.on("finish", resolve);
            writableStream.on("error", reject);
        });

        console.log(`File saved: ${nombreArchivo}\n`);
        return nombreArchivo;
    } catch (error) {
        console.error(`Error downloading file: ${error.message}`);
        return null;
    }
}

function ejecutarComandoShell(comando) {
    return new Promise((resolve, reject) => {
        exec(comando, (error, stdout) => {
            if (error) {
                console.error(`Error running command: ${error.message}`);
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
}

async function eliminarArchivo(nombreArchivo) {
    try {
        await fs.promises.unlink(nombreArchivo);
    } catch (error) {
        console.log(`Error deleting file ${nombreArchivo}: ${error.message}`);
    }
}

async function descargarVideoYAudio(apiInfo, directorioDestino = "./Downloads") {
    if (!fs.existsSync(directorioDestino)) {
        fs.mkdirSync(directorioDestino, { recursive: true });
    }

    console.log(`\n${apiInfo.descripcion}`);
    console.log("Fetching stream URLs...\n");

    const urls = await obtenerUrlDeVideoYAudio(apiInfo);
    if (!urls) {
        console.log("Could not retrieve stream URLs. Aborting.");
        return;
    }

    console.log("Stream URLs found!\n");

    // Nombres únicos usando timestamp + random para evitar colisiones
    const uid = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const archivoVideo = `${directorioDestino}/${uid}_video.m4v`;
    const archivoAudio = `${directorioDestino}/${uid}_audio.mp4`;
    const archivoFinal = `${directorioDestino}/${uid}_final.mp4`;

    await descargarArchivo(urls.urlVideo, archivoVideo);
    await descargarArchivo(urls.urlAudio, archivoAudio);

    console.log("Merging video and audio with ffmpeg...");
    const comandoFFmpeg = `ffmpeg -i "${archivoVideo}" -i "${archivoAudio}" -vcodec copy -acodec copy -f mp4 "${archivoFinal}" -y -loglevel error`;

    await ejecutarComandoShell(comandoFFmpeg);

    console.log(`\nFinal file: ${archivoFinal}\n`);

    await eliminarArchivo(archivoVideo);
    await eliminarArchivo(archivoAudio);
    console.log("Temporary files deleted.");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const cookies = cargarCookiesDesdeArchivo("./cookies.txt");

axios.defaults.headers.common["referer"] = "https://www.bilibili.tv/";
if (cookies) {
    axios.defaults.headers.common["cookie"] = cookies;
    console.log("Cookies loaded successfully.");
} else {
    console.log("No cookies loaded.");
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

console.log(nombre);
console.log("                     https://github.com/jjaruna \n");

rl.question("Enter the link: ", async (enlaceOriginal) => {
    rl.close();

    const info = obtenerInfoDelLink(enlaceOriginal);

    if (!info.ok) {
        console.log(`\nError: ${info.error}`);
        return;
    }

    if (info.nota) {
        console.log(`\nNote: ${info.nota}`);
    }

    const apiInfo = construirInfoApi(info);
    if (!apiInfo) {
        console.log("Could not build API info from link.");
        return;
    }

    await descargarVideoYAudio(apiInfo);
});

