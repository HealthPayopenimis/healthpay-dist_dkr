#!/usr/bin/env python3
"""Local loopback-only TLS regression. Never connects to QA or reads real keys."""
from pathlib import Path
import re,socket,ssl,subprocess,tempfile,threading,unittest
CONFIG=Path(__file__).resolve().parents[1]/'conf/nginx-healthpay/openimis.conf'
OLD='ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-RSA-AES128-GCM-SHA256'
NEW=re.search(r'ssl_ciphers\s+"([^"]+)";',CONFIG.read_text()).group(1)
class TLSCipherTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory();d=Path(cls.tmp.name);cls.certs={}
  for alg in ('ec','rsa'):
   key=d/(alg+'.key');cert=d/(alg+'.crt')
   if alg=='ec':cmd=['openssl','req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1']
   else:cmd=['openssl','req','-x509','-newkey','rsa:2048']
   subprocess.run(cmd+['-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=healthpay-tls-test.invalid'],check=True,capture_output=True)
   key.chmod(0o600);cls.certs[alg]=(cert,key)
 @classmethod
 def tearDownClass(cls):cls.tmp.cleanup()
 def handshake(self,alg,ciphers,version):
  cert,key=self.certs[alg];ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(cert,key);ctx.minimum_version=version;ctx.maximum_version=version;ctx.set_ciphers(ciphers)
  listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1);listener.settimeout(3);address=listener.getsockname();results=[]
  def server():
   try:
    raw,_=listener.accept();raw.settimeout(3)
    with ctx.wrap_socket(raw,server_side=True) as s:results.append(s.version());s.recv(1)
   except (ssl.SSLError,OSError):results.append('FAILED')
   finally:listener.close()
  thread=threading.Thread(target=server,daemon=True);thread.start()
  client=ssl.create_default_context(cafile=str(cert));client.minimum_version=version;client.maximum_version=version;ok=False
  try:
   with socket.create_connection(address,timeout=3) as raw:
    with client.wrap_socket(raw,server_hostname='healthpay-tls-test.invalid') as s:s.send(b'x');ok=True
  except (ssl.SSLError,OSError):pass
  thread.join(4);self.assertFalse(thread.is_alive());return ok
 def test_old_rsa_only_fails_ecdsa_tls12(self):self.assertFalse(self.handshake('ec',OLD,ssl.TLSVersion.TLSv1_2))
 def test_new_list_passes_ecdsa_tls12(self):self.assertTrue(self.handshake('ec',NEW,ssl.TLSVersion.TLSv1_2))
 def test_rsa_tls12_remains_supported(self):self.assertTrue(self.handshake('rsa',NEW,ssl.TLSVersion.TLSv1_2))
 def test_ecdsa_tls13_remains_supported(self):self.assertTrue(self.handshake('ec',NEW,ssl.TLSVersion.TLSv1_3))
 def test_old_ecdsa_tls13_explains_modern_client_success(self):self.assertTrue(self.handshake('ec',OLD,ssl.TLSVersion.TLSv1_3))
 def test_no_protocol_downgrade_or_weak_ciphers(self):
  self.assertRegex(CONFIG.read_text(),r'ssl_protocols TLSv1\.2 TLSv1\.3;')
  names=NEW.split(':');self.assertEqual(len(names),6);self.assertTrue(all(x.startswith('ECDHE-') and ('GCM' in x or 'CHACHA20-POLY1305' in x) for x in names));self.assertTrue(set(OLD.split(':')).issubset(names))
if __name__=='__main__':unittest.main()
