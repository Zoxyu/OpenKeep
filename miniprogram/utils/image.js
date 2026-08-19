/**
 * 图片工具：封面照片的持久化保存、删除与有效性检查。
 * 拍照 / 相册返回的是临时路径，重启后可能失效，
 * 因此必须复制到 wx.env.USER_DATA_PATH 下长期保存。
 */
const fs = wx.getFileSystemManager();

// 将临时图片复制到本地持久化目录，Promise 返回保存后的路径
function savePhoto(tempPath) {
  return new Promise((resolve, reject) => {
    if (!tempPath) {
      reject(new Error('empty temp path'));
      return;
    }
    const m = tempPath.match(/\.(jpg|jpeg|png|webp|gif)$/i);
    const ext = m ? m[1].toLowerCase() : 'jpg';
    const dest = wx.env.USER_DATA_PATH + '/openkeep_photo_' + Date.now() + '_' + Math.floor(Math.random() * 1000000) + '.' + ext;
    fs.copyFile({
      srcPath: tempPath,
      destPath: dest,
      success: () => resolve(dest),
      fail: err => reject(err)
    });
  });
}

// 删除本地照片文件；出于安全，只允许删除本应用保存在 USER_DATA_PATH 下的文件
function removePhoto(path) {
  if (!path || typeof path !== 'string') return;
  if (path.indexOf(wx.env.USER_DATA_PATH) !== 0) return;
  try {
    fs.unlinkSync(path);
  } catch (e) {
    // 文件不存在等情况静默忽略
  }
}

// 检查照片文件是否仍然存在（临时路径失效 / 文件被清理时返回 false）
function isPhotoValid(path) {
  if (!path || typeof path !== 'string') return false;
  try {
    fs.accessSync(path);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  savePhoto,
  removePhoto,
  isPhotoValid
};
