// ws.js — 极简 WebSocket 服务端（RFC 6455 子集：文本广播 + ping/pong + close，零依赖）
// 配合 server.js 使用：attachCollab(server, roomOf) 挂到 http server 的 upgrade 事件；
// 客户端按 /<库名>/ws?cid=<客户端id> 连接，broadcast 向同房间连接推送文本（可按 cid 排除发起者）。
const crypto = require(`node:crypto`)

const GUID = `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`
const MAX_FRAME = 1 << 20 // 入帧上限 1MB：本服务只推不收，客户端消息超此值视为异常

// 编码一个服务端数据帧（服务端帧不掩码）
function encodeFrame(opcode, payload) {
	const len = payload.length
	let head
	if (len < 126) {
		head = Buffer.from([0x80 | opcode, len])
	} else if (len < 65536) {
		head = Buffer.alloc(4)
		head[0] = 0x80 | opcode
		head[1] = 126
		head.writeUInt16BE(len, 2)
	} else {
		head = Buffer.alloc(10)
		head[0] = 0x80 | opcode
		head[1] = 127
		head.writeBigUInt64BE(BigInt(len), 2)
	}
	return Buffer.concat([head, payload])
}

/**
 * 挂接协作广播服务。roomOf(pathname) 返回房间名（返回 null 则拒绝握手）。
 * 返回 {broadcast(room, text, exceptCid)}。
 */
function attachCollab(server, roomOf) {
	const clients = new Set() // {socket, room, cid, buf}

	function handleFrame(client, opcode, payload) {
		const {socket} = client
		if (opcode === 0x8) { // close：回以 close 帧后断开
			try {
				socket.write(encodeFrame(0x8, Buffer.alloc(0)))
			} catch (err) {
				// 已断，忽略
			}
			socket.destroy()
			return
		}
		if (opcode === 0x9) { // ping → pong
			try {
				socket.write(encodeFrame(0xA, payload))
			} catch (err) {
				socket.destroy()
			}
			return
		}
		if (opcode === 0xA) return // pong
		// 数据帧（text/binary/continuation）：本服务只推不收，忽略内容
		if (opcode === 0x1 || opcode === 0x0 || opcode === 0x2) return
		socket.destroy() // 其余 opcode 不支持
	}

	// 从缓冲区尽可能解析完整帧
	function drain(client) {
		const {socket} = client
		for (;;) {
			const buf = client.buf
			if (buf.length < 2) return
			const b0 = buf[0], b1 = buf[1]
			const opcode = b0 & 0x0f
			const masked = (b1 & 0x80) !== 0
			let len = b1 & 0x7f
			let off = 2
			if (len === 126) {
				if (buf.length < off + 2) return
				len = buf.readUInt16BE(off)
				off += 2
			} else if (len === 127) {
				if (buf.length < off + 8) return
				len = Number(buf.readBigUInt64BE(off))
				off += 8
			}
			if (len > MAX_FRAME) {
				socket.destroy()
				return
			}
			const maskAt = off
			if (masked) off += 4
			if (buf.length < off + len) return
			let payload = buf.subarray(off, off + len)
			if (masked) { // 客户端帧必须带掩码：按掩码还原
				const mask = buf.subarray(maskAt, maskAt + 4)
				const un = Buffer.allocUnsafe(len)
				for (let i = 0; i < len; i++) un[i] = payload[i] ^ mask[i & 3]
				payload = un
			}
			client.buf = buf.subarray(off + len)
			handleFrame(client, opcode, payload)
			if (socket.destroyed) return
		}
	}

	server.on(`upgrade`, (req, socket) => {
		socket.setNoDelay(true)
		let room = null, cid = ``
		try {
			const host = req.headers.host || `localhost`
			const url = new URL(req.url, `http://${host}`)
			room = roomOf(decodeURIComponent(url.pathname))
			cid = String(url.searchParams.get(`cid`) || ``)
		} catch (err) {
			room = null
		}
		const key = req.headers[`sec-websocket-key`]
		const isWs = String(req.headers.upgrade || ``).toLowerCase() === `websocket`
		if (!room || !key || !isWs) {
			socket.destroy()
			return
		}
		const accept = crypto.createHash(`sha1`).update(key + GUID).digest(`base64`)
		socket.write(
			`HTTP/1.1 101 Switching Protocols\r\n` +
			`Upgrade: websocket\r\n` +
			`Connection: Upgrade\r\n` +
			`Sec-WebSocket-Accept: ${accept}\r\n\r\n`
		)
		const client = {socket, room, cid, buf: Buffer.alloc(0)}
		clients.add(client)
		socket.on(`close`, () => clients.delete(client))
		socket.on(`error`, () => clients.delete(client))
		socket.on(`data`, d => {
			client.buf = Buffer.concat([client.buf, d])
			try {
				drain(client)
			} catch (err) {
				socket.destroy()
			}
		})
	})

	// 心跳：防止代理掐断空闲连接，顺带暴露已死的 socket
	const beat = setInterval(() => {
		clients.forEach(c => {
			try {
				c.socket.write(encodeFrame(0x9, Buffer.alloc(0)))
			} catch (err) {
				c.socket.destroy()
			}
		})
	}, 25000)
	beat.unref()

	function broadcast(room, text, exceptCid = ``) {
		const frame = encodeFrame(0x1, Buffer.from(text, `utf8`))
		clients.forEach(c => {
			if (c.room !== room || (exceptCid && c.cid === exceptCid)) return
			try {
				c.socket.write(frame)
			} catch (err) {
				c.socket.destroy()
			}
		})
	}

	return {broadcast}
}

module.exports = {attachCollab}
