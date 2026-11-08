# 通用 Linux 部署脚本（Debian/Ubuntu 系，需要 root）
#
# 用法:
#   bash deploy/install.sh
#
# 说明:
#   - 需要 Node.js >= 20
#   - 安装到 /opt/emit-smtp，用独立低权用户 emit-smtp 运行
#   - 环境变量放 /etc/emit-smtp/env（权限 640，组 emit-smtp）
#   - 注册 emit-smtp（SMTP + Web）与 emit-smtp-ctl（root 守护）两个 systemd 服务
set -euo pipefail

APP_DIR=/opt/emit-smtp
ENV_DIR=/etc/emit-smtp
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> 1/7 检查 Node.js"
if ! command -v node >/dev/null 2>&1; then
  echo "    未检测到 Node.js。请先安装 Node 20+ LTS："
  echo "      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -"
  echo "      apt-get install -y nodejs"
  exit 1
fi
node -v
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "    需要 Node >= 20，当前 $NODE_MAJOR"
  exit 1
fi

echo "==> 2/7 安装应用与依赖"
mkdir -p "$APP_DIR"
cp -rf "$SRC_DIR/src" "$APP_DIR/"
cp -rf "$SRC_DIR/web" "$APP_DIR/"
cp -f "$SRC_DIR/package.json" "$APP_DIR/"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund

echo "==> 3/7 创建系统用户与数据目录"
id -u emit-smtp >/dev/null 2>&1 || \
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin emit-smtp
mkdir -p "$APP_DIR/data"
chown -R emit-smtp:emit-smtp "$APP_DIR"
# ctl-server 由 root 服务执行：脚本必须归 root，防止低权用户篡改提权
chown root:root "$APP_DIR/src/ctl-server.mjs"
chmod 755 "$APP_DIR/src/ctl-server.mjs"

echo "==> 4/7 生成自签证书"
mkdir -p "$ENV_DIR"
if [ ! -f "$ENV_DIR/cert.pem" ]; then
  openssl req -x509 -newkey rsa:2048 \
    -keyout "$ENV_DIR/key.pem" -out "$ENV_DIR/cert.pem" \
    -days 3650 -nodes -subj "/CN=emit-smtp-bridge" 2>/dev/null
  chown root:emit-smtp "$ENV_DIR/cert.pem" "$ENV_DIR/key.pem"
  chmod 640 "$ENV_DIR/cert.pem"
  chmod 600 "$ENV_DIR/key.pem"
  echo "    已生成 $ENV_DIR/cert.pem"
else
  echo "    $ENV_DIR/cert.pem 已存在，跳过"
fi

echo "==> 5/7 写入环境配置"
if [ ! -f "$ENV_DIR/env" ]; then
  cp "$SRC_DIR/.env.example" "$ENV_DIR/env"
  WEB_PASS="$(openssl rand -base64 18 | tr -d '/+=' | head -c 16)"
  CREDS="$(node "$SRC_DIR/deploy/gen-web-credentials.mjs" "$WEB_PASS")"
  SALT="$(printf '%s\n' "$CREDS" | sed -n 's/^WEB_SALT=//p')"
  HASH="$(printf '%s\n' "$CREDS" | sed -n 's/^WEB_PASS_HASH=//p')"
  SESSION="$(openssl rand -hex 32)"
  cat >> "$ENV_DIR/env" <<EOF

# ── Web 管理台（install.sh 自动生成）───────────────────────────
WEB_PORT=3000
WEB_USER=admin
WEB_PASS_HASH=$HASH
WEB_SALT=$SALT
WEB_SESSION_SECRET=$SESSION
WEB_CERT=$ENV_DIR/cert.pem
WEB_KEY=$ENV_DIR/key.pem
EMIT_HISTORY_FILE=$APP_DIR/data/history.jsonl
CTL_SOCK=/run/emit-smtp/ctl.sock
EOF
  echo "    已生成 $ENV_DIR/env"
  echo "    ──────────────────────────────────────────────"
  echo "    初始 Web 登录账号: admin"
  echo "    初始 Web 登录密码: $WEB_PASS   （登录后请立即修改）"
  echo "    ──────────────────────────────────────────────"
else
  echo "    $ENV_DIR/env 已存在，保持不变"
fi
chown root:emit-smtp "$ENV_DIR/env"
chmod 640 "$ENV_DIR/env"

echo "==> 6/7 注册 systemd 服务"
cp -f "$SRC_DIR/deploy/emit-smtp.service" /etc/systemd/system/emit-smtp.service
cp -f "$SRC_DIR/deploy/emit-smtp-ctl.service" /etc/systemd/system/emit-smtp-ctl.service
systemctl daemon-reload
systemctl enable emit-smtp emit-smtp-ctl

echo "==> 7/7 启动服务"
systemctl restart emit-smtp-ctl
systemctl restart emit-smtp
sleep 3
systemctl --no-pager --full status emit-smtp emit-smtp-ctl || true

cat <<'EOF'

完成。下一步：
  1) 填 Emit key:  sudo vi /etc/emit-smtp/env     （EMIT_API_KEY）
  2) 重启:         sudo systemctl restart emit-smtp
  3) 放行端口:     sudo ufw allow 2465/tcp        # SMTP
                   sudo ufw allow 3000/tcp        # Web 管理台
  4) 打开管理台:   https://服务器IP:3000           （自签证书，点“继续前往”）
  5) 邮件客户端:   服务器=IP 端口=2465 加密=SSL/TLS 开启认证

  ⚠ 端口注意：云厂商默认封 25/465/587；高位端口（2465/3000）也要在控制台安全组放行。
EOF
