const path = require('node:path');

module.exports = (_env, argv) => {
    const isProduction = (argv && argv.mode) === 'production';
    return {
        entry: './src/client/js/app.js',
        mode: isProduction ? 'production' : 'development',
        output: {
            path: path.resolve(__dirname, 'bin/client/js'),
            library: 'app',
            filename: 'app.js'
        },
        devtool: false,
        module: {
            rules: isProduction ? [{
                test: /\.(?:js|mjs|cjs)$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: [['@babel/preset-env', { targets: 'defaults' }]]
                    }
                }
            }] : []
        }
    };
};
