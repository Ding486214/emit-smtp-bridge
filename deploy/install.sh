# 通用 Linux 部署脚本（Debian/Ubuntu 系，需要 root）
#
# 用法:
#   bash deploy/install.sh
#
# 说明:
#   - 需要 Node.js >= 20
#   - 安装到 /opt/emit-smtp，用独立低权用户 emit-smtp 运行
#   - 环境变量放 /etc/emit-smtp/env（权限 600）
#   - 注册 systemd 服务并设置开机自启
set -euo pipefail

APP_DIR=/opt/emit-smtp
ENV_DIR=/etc/emit-smtp
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> 1/6 检查 Node.js"
if ! command -v node >/dev/null 2>&1; then
  cat <<'EOF'
    未检测到 Node.js。请先安装 Node 22 LTS：
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
      apt-get install -y nodejs
EOF
  exit 1
fi
node -v
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "    需要 Node >= 20，当前 $NODE_MAJOR"
  exit 1
fi

echo "==> 2/6 安装应用与依赖"
mkdir -p "$APP_DIR"
cp -rf "$SRC_DIR/src" "$APP_DIR/"
cp -f "$SRC_DIR/package.json" "$APP_DIR/"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund

echo "==> 3/6 创建系统用户"
id -u emit-smtp >/dev/null 2>&1 || \
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin emit-smtp
chown -R emit-smtp:emit-smtp "$APP_DIR"

echo "==> 4/6 写入环境配置"
mkdir -p "$ENV_DIR"
if [ ! -f "$ENV_DIR/env" ]; then
  cp "$SRC_DIR/.env.example" "$ENV_DIR/env"
  chmod 600 "$ENV_DIR/env"
  chown root:emit-smtp "$ENV_DIR/env"
  echo "    已生成 $ENV_DIR/env"
else
  echo "    $ENV_DIR/env 已存在，保持不变"
fi

echo "==> 5/6 注册 systemd 服务"
cp -f "$SRC_DIR/deploy/emit-smtp.service" /etc/systemd/system/emit-smtp.service
systemctl daemon-reload
systemctl enable emit-smtp

echo "==> 6/6 启动服务"
systemctl restart emit-smtp
sleep 2
systemctl --no-pager --full status emit-smtp || true

cat <<'EOF'

完成。下一步：
  1) 填凭据:  sudo vi /etc/emit-smtp/env
               （EMIT_API_KEY / EMIT_SMTP_USER / EMIT_SMTP_PASS）
  2) 重启:    sudo systemctl restart emit-smtp
  3) 看日志:  sudo journalctl -u emit-smtp -f
  4) 放行:    sudo ufw allow 2465/tcp

  ⚠ 端口注意：绝大多数云厂商（阿里云/腾讯云/AWS/GCP…）默认封禁
     25 / 465 / 587 这些垃圾邮件高危端口，服务器上 ufw 放行了也连不通。
     请优先使用高位端口（如 2465），并在云控制台安全组里放行。
     若坚持用 587 等 <1024 端口，需要给服务加绑定能力：
       mkdir -p /etc/systemd/system/emit-smtp.service.d
       printf '[Service]\nAmbientCapabilities=CAP_NET_BIND_SERVICE\n' \
         > /etc/systemd/system/emit-smtp.service.d/caps.conf
       systemctl daemon-reload && systemctl restart emit-smtp

  5) 客户端:  服务器=IP 端口=2465 加密=SSL/TLS 开启认证
EOF
