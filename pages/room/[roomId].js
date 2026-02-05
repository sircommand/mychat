import { useEffect, useRef, useState } from "react";

const SIGNALING_URL = "wss://representative-katie-evaluate-scores.trycloudflare.com";

export default function RoomPage({ roomId }) {
  const localVideo = useRef(null);
  const remoteVideoRefs = [useRef(null), useRef(null)];
  const [streams, setStreams] = useState([null, null, null]);
  const [chat, setChat] = useState([]);
  const [message, setMessage] = useState("");
  const wsRef = useRef(null);
  const userIdRef = useRef(null); // فقط مقدار قطعی userId واقعی کاربر را نگه می‌دارد
  const peersInfo = useRef({});

  // helper
  function findEmptyRemoteIndex() {
    for (let i = 1; i <= 2; ++i)
      if (!streams[i]) return i;
    return null;
  }
  function addRemoteStream(peerId, stream) {
    setStreams(prev => {
      const remoteIndex = findEmptyRemoteIndex();
      if (remoteIndex) {
        const newStreams = [...prev];
        newStreams[remoteIndex] = stream;
        peersInfo.current[peerId].streamIndex = remoteIndex;
        return newStreams;
      }
      return prev;
    });
  }

  useEffect(() => {
    let localStream;

    async function init() {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStreams(s => [localStream, null, null]);
      if (localVideo.current) localVideo.current.srcObject = localStream;

      const ws = new window.WebSocket(SIGNALING_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ action: "join_room", roomId }));
      };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        // 1- دریافت userId واقعی
        if (msg.action === "your_id") {
          userIdRef.current = msg.userId;
          return;
        }

        // 2- دریافت peers فعلی و ساختن PeerConnection
        if (msg.action === "peers") {
          if (!userIdRef.current) return; // صبر کن تا userId دقیقا ست شود!

          // حذف peers بسته‌شده
          Object.keys(peersInfo.current).forEach(peerId => {
            if (!msg.peers.includes(peerId)) {
              if (peersInfo.current[peerId].pc) peersInfo.current[peerId].pc.close();
              setStreams(prev => {
                const ind = peersInfo.current[peerId].streamIndex || 1;
                const newStreams = [...prev];
                newStreams[ind] = null;
                return newStreams;
              });
              delete peersInfo.current[peerId];
            }
          });

          // ایجاد PeerConnection برای هر peer جدید
          msg.peers.forEach(peerId => {
            if (peerId !== userIdRef.current && !peersInfo.current[peerId]) {
              const pc = new RTCPeerConnection();
              pc.onicecandidate = event => {
                if (event.candidate) {
                  ws.send(JSON.stringify({
                    action: "signal",
                    target: peerId,
                    from: userIdRef.current,
                    type: "candidate",
                    candidate: event.candidate,
                  }));
                }
              };
              pc.ontrack = (event) => {
                if (!peersInfo.current[peerId].stream) {
                  peersInfo.current[peerId].stream = event.streams[0];
                  addRemoteStream(peerId, event.streams[0]);
                  if (peersInfo.current[peerId].streamIndex) {
                    if (remoteVideoRefs[peersInfo.current[peerId].streamIndex - 1].current)
                      remoteVideoRefs[peersInfo.current[peerId].streamIndex - 1].current.srcObject = event.streams[0];
                  }
                }
              };
              localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
              peersInfo.current[peerId] = { pc };

              // فقط اگر userId تو بزرگ‌تر از peer است (خودت offer باشی)
              if (userIdRef.current > peerId) {
                pc.createOffer().then(offer => {
                  pc.setLocalDescription(offer);
                  ws.send(JSON.stringify({
                    action: "signal",
                    target: peerId,
                    from: userIdRef.current,
                    type: "offer",
                    sdp: offer,
                  }));
                });
              }
            }
          });
        }
        // 3- سیگنالینگ با peer
        else if (msg.action === "signal") {
          if (!userIdRef.current) return;
          let peerId = msg.from;
          if (!peersInfo.current[peerId]) {
            // ایجاد connection درصورت نیاز (چون شاید جواب offer باشی)
            const pc = new RTCPeerConnection();
            pc.onicecandidate = event => {
              if (event.candidate) {
                ws.send(JSON.stringify({
                  action: "signal",
                  target: peerId,
                  from: userIdRef.current,
                  type: "candidate",
                  candidate: event.candidate,
                }));
              }
            };
            pc.ontrack = (event) => {
              if (!peersInfo.current[peerId].stream) {
                peersInfo.current[peerId].stream = event.streams[0];
                addRemoteStream(peerId, event.streams[0]);
                if (peersInfo.current[peerId].streamIndex) {
                  if (remoteVideoRefs[peersInfo.current[peerId].streamIndex - 1].current)
                    remoteVideoRefs[peersInfo.current[peerId].streamIndex - 1].current.srcObject = event.streams[0];
                }
              }
            };
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
            peersInfo.current[peerId] = { pc };
          }
          const pc = peersInfo.current[peerId].pc;

          if (msg.type === "offer") {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({
              action: "signal",
              target: peerId,
              from: userIdRef.current,
              type: "answer",
              sdp: answer,
            }));
          }
          else if (msg.type === "answer") {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          }
          else if (msg.type === "candidate" && msg.candidate) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch (e) {}
          }
        }
        // مدیریت باقی پیام‌ها
        else if (msg.action === "force_leave") {
          alert("اتاق پر است");
          window.location = "/";
        }
        else if (msg.action === "chat") {
          setChat(old => [...old, { from: msg.from, text: msg.text }]);
        }
      };
    }

    init();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (localStream) localStream.getTracks().forEach(t => t.stop());
      Object.values(peersInfo.current).forEach(o => o.pc && o.pc.close());
    };
    // eslint-disable-next-line
  }, [roomId]);

  // رفرش stream‌ها در refs
  useEffect(() => {
    for (let i = 1; i <= 2; ++i) {
      if (streams[i] && remoteVideoRefs[i-1].current)
        remoteVideoRefs[i-1].current.srcObject = streams[i];
    }
  }, [streams]);

  return (
    <div style={{display: "flex", height: "100vh"}}>
      <div style={{flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'}}>
        {/* باکس تصویر کاربران */}
        <video ref={localVideo} autoPlay muted playsInline style={{width: "100%", maxWidth: 320, border: "2px solid green", margin: "10px"}} />
        <video ref={remoteVideoRefs[0]} autoPlay playsInline style={{width: "100%", maxWidth: 320, border: "2px solid red", margin: "10px"}} />
        <video ref={remoteVideoRefs[1]} autoPlay playsInline style={{width: "100%", maxWidth: 320, border: "2px solid blue", margin: "10px"}} />
      </div>
      <div style={{flex: 1, background: "#eee", display: 'flex', flexDirection: "column"}}>
        <h3>چت متنی</h3>
        <div style={{height: 400, overflowY: "auto", flex: 1}}>
          {chat.map((c, i) => <div key={i}><b>{c.from}: </b>{c.text}</div>)}
        </div>
        <div style={{display: "flex"}}>
          <input value={message} onChange={e=>setMessage(e.target.value)} style={{flex: 1}} />
          <button onClick={() => {
            if (wsRef.current && message) {
              wsRef.current.send(JSON.stringify({ action: "chat", text: message, from: userIdRef.current }));
              setMessage("");
            }
          }}>ارسال</button>
        </div>
      </div>
    </div>
  );
}

RoomPage.getInitialProps = async ({ query }) => ({ roomId: query.roomId });